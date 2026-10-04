-- =============================================================================
-- Migration 011: Razorpay Fixes (Cart, Inventory, Duplicates)
-- =============================================================================

BEGIN;

-- 1. REWRITE place_order RPC TO ONLY CLEAR CART ON PAY_AT_COUNTER
-- This ensures online payments don't lose the cart if they are abandoned before payment.

CREATE OR REPLACE FUNCTION place_order(
    p_cart_id UUID, p_pickup_slot_id UUID, p_payment_method TEXT DEFAULT 'PAY_AT_COUNTER'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id   UUID := auth.uid();
    v_cart      RECORD; v_outlet RECORD; v_slot RECORD; v_item RECORD;
    v_customization RECORD;
    v_order_id  UUID;
    v_subtotal  DECIMAL(10,2) := 0;
    v_tax       DECIMAL(10,2) := 0;
    v_total     DECIMAL(10,2) := 0;
    v_prep      INTEGER := 0;
    v_inv_qty   INTEGER;
    v_item_subtotal DECIMAL(10,2);
    v_order_item_id UUID;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

    SELECT * INTO v_cart FROM carts WHERE id = p_cart_id AND user_id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cart not found or not owned by user.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM cart_items WHERE cart_id = p_cart_id)
    THEN RAISE EXCEPTION 'Cart is empty.'; END IF;

    SELECT * INTO v_outlet FROM outlets WHERE id = v_cart.outlet_id;
    IF NOT FOUND          THEN RAISE EXCEPTION 'Outlet not found.'; END IF;
    IF NOT v_outlet.is_active THEN RAISE EXCEPTION 'Outlet is not active.'; END IF;
    IF NOT v_outlet.is_open   THEN RAISE EXCEPTION 'Outlet is currently closed.'; END IF;

    SELECT * INTO v_slot FROM pickup_slots
    WHERE id = p_pickup_slot_id AND outlet_id = v_cart.outlet_id FOR UPDATE;
    IF NOT FOUND                        THEN RAISE EXCEPTION 'Pickup slot not found for this outlet.'; END IF;
    IF v_slot.slot_date < CURRENT_DATE  THEN RAISE EXCEPTION 'Pickup slot is in the past.'; END IF;
    IF v_slot.booked_count >= v_slot.capacity THEN RAISE EXCEPTION 'Pickup slot is full.'; END IF;

    -- Create order first so we can insert order_items with accurate dynamic pricing
    INSERT INTO orders (
        order_number, user_id, vendor_id, outlet_id, pickup_slot_id,
        subtotal, tax, total, status, payment_status, payment_method,
        estimated_prep_minutes, placed_at
    ) VALUES (
        'GAG-' || TO_CHAR(NOW(),'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text,1,6)),
        v_user_id, v_outlet.vendor_id, v_outlet.id, p_pickup_slot_id,
        0, 0, 0, 'PLACED', 'PENDING', p_payment_method::payment_method,
        0, NOW()
    ) RETURNING id INTO v_order_id;

    FOR v_item IN
        SELECT ci.id AS cart_item_id, ci.food_item_id, ci.quantity,
               fi.name AS food_name, fi.image_url, fi.price AS base_price,
               fi.is_veg, fi.is_available, fi.prep_time_minutes, fi.outlet_id AS item_outlet
        FROM cart_items ci JOIN food_items fi ON ci.food_item_id = fi.id
        WHERE ci.cart_id = p_cart_id
    LOOP
        IF v_item.item_outlet != v_cart.outlet_id THEN RAISE EXCEPTION 'Cart integrity error.'; END IF;
        IF NOT v_item.is_available THEN RAISE EXCEPTION 'Item "%" is unavailable.', v_item.food_name; END IF;
        IF v_item.quantity <= 0    THEN RAISE EXCEPTION 'Invalid quantity for "%".', v_item.food_name; END IF;

        SELECT quantity_available INTO v_inv_qty FROM inventory
        WHERE food_item_id = v_item.food_item_id FOR UPDATE;
        IF NOT FOUND           THEN RAISE EXCEPTION 'No inventory for "%".', v_item.food_name; END IF;
        IF v_inv_qty < v_item.quantity THEN
            RAISE EXCEPTION 'Insufficient stock for "%". Have %, need %.', v_item.food_name, v_inv_qty, v_item.quantity;
        END IF;

        v_item_subtotal := v_item.base_price;

        -- Insert order_item first to get ID for customizations
        INSERT INTO order_items (order_id, food_item_id, food_name, food_image_url, quantity, unit_price, total_price, is_veg)
        VALUES (v_order_id, v_item.food_item_id, v_item.food_name, v_item.image_url, v_item.quantity, v_item.base_price, v_item.base_price * v_item.quantity, v_item.is_veg)
        RETURNING id INTO v_order_item_id;

        -- Handle customizations securely (lookup DB extra_price)
        FOR v_customization IN
            SELECT fv.name AS variant_name, fvo.name AS option_name, fvo.extra_price AS db_extra_price
            FROM cart_item_customizations cic
            JOIN food_variants fv ON fv.id = cic.variant_id
            JOIN food_variant_options fvo ON fvo.id = cic.option_id
            WHERE cic.cart_item_id = v_item.cart_item_id
              AND fv.food_item_id = v_item.food_item_id
              AND fvo.variant_id = fv.id
        LOOP
            v_item_subtotal := v_item_subtotal + v_customization.db_extra_price;

            INSERT INTO order_item_customizations (order_item_id, variant_name, option_name, extra_price)
            VALUES (v_order_item_id, v_customization.variant_name, v_customization.option_name, v_customization.db_extra_price);
        END LOOP;

        -- Update the final unit price with customization totals
        UPDATE order_items 
        SET unit_price = v_item_subtotal, total_price = v_item_subtotal * v_item.quantity 
        WHERE id = v_order_item_id;

        v_subtotal := v_subtotal + (v_item_subtotal * v_item.quantity);
        v_prep     := GREATEST(v_prep, v_item.prep_time_minutes);
    END LOOP;

    v_tax   := ROUND(v_subtotal * 0.05, 2);
    v_total := v_subtotal + v_tax;

    UPDATE orders 
    SET subtotal = v_subtotal, tax = v_tax, total = v_total, estimated_prep_minutes = v_prep
    WHERE id = v_order_id;

    UPDATE inventory inv SET quantity_available = quantity_available - ci.quantity, updated_at = NOW()
    FROM cart_items ci WHERE ci.cart_id = p_cart_id AND inv.food_item_id = ci.food_item_id;

    UPDATE pickup_slots SET booked_count = booked_count + 1,
        status = CASE
            WHEN booked_count+1 >= capacity       THEN 'FULL'::pickup_slot_status
            WHEN booked_count+1 >= capacity * 0.8 THEN 'LIMITED'::pickup_slot_status
            ELSE 'AVAILABLE'::pickup_slot_status END
    WHERE id = p_pickup_slot_id;

    INSERT INTO pickup_tokens (order_id, token_value, expires_at)
    VALUES (v_order_id, encode(gen_random_bytes(32),'hex'), NOW() + INTERVAL '2 hours');

    UPDATE payments SET amount = v_total WHERE order_id = v_order_id;
    IF NOT FOUND THEN
        INSERT INTO payments (order_id, amount, currency, status)
        VALUES (v_order_id, v_total, 'INR', 'PENDING');
    END IF;

    -- ONLY CLEAR CART IF PAY_AT_COUNTER
    IF p_payment_method = 'PAY_AT_COUNTER' THEN
        DELETE FROM cart_items WHERE cart_id = p_cart_id;
        UPDATE carts SET outlet_id=NULL, subtotal=0, tax=0, total=0, updated_at=NOW() WHERE id=p_cart_id;
    END IF;

    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (v_user_id, 'ORDER_PLACED', 'orders', v_order_id,
            jsonb_build_object('outlet_id', v_outlet.id, 'total', v_total));

    RETURN v_order_id;
END;
$$;


-- 2. REWRITE mark_payment_verified TO CLEAR THE CART SECURELY
CREATE OR REPLACE FUNCTION mark_payment_verified(
    p_order_id UUID,
    p_razorpay_payment_id TEXT,
    p_razorpay_signature TEXT,
    p_status payment_status DEFAULT 'PAID'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Update payment record
    UPDATE payments
    SET razorpay_payment_id = p_razorpay_payment_id,
        razorpay_signature = p_razorpay_signature,
        status = p_status,
        updated_at = NOW()
    WHERE order_id = p_order_id;

    -- Update order status
    UPDATE orders
    SET payment_status = p_status,
        updated_at = NOW()
    WHERE id = p_order_id
    RETURNING user_id INTO v_user_id;

    -- Clear cart if payment is PAID or CAPTURED
    IF p_status IN ('PAID', 'CAPTURED') THEN
        DELETE FROM cart_items WHERE cart_id = (SELECT id FROM carts WHERE user_id = v_user_id LIMIT 1);
        UPDATE carts SET outlet_id=NULL, subtotal=0, tax=0, total=0, updated_at=NOW() WHERE user_id = v_user_id;
    END IF;
END;
$$;


-- 3. REWRITE TRIGGER TO RESTORE INVENTORY & SLOTS ON CANCEL/REJECT
CREATE OR REPLACE FUNCTION restore_inventory_and_slots_on_cancel() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_item RECORD;
BEGIN
    -- If the order is transitioning to CANCELLED or REJECTED
    IF NEW.status IN ('CANCELLED', 'REJECTED') AND OLD.status NOT IN ('CANCELLED', 'REJECTED') THEN
        
        -- 1. Restore slots
        IF NEW.pickup_slot_id IS NOT NULL THEN
            UPDATE pickup_slots SET booked_count = GREATEST(booked_count - 1, 0),
                status = CASE
                    WHEN GREATEST(booked_count - 1, 0) >= capacity THEN 'FULL'::pickup_slot_status
                    WHEN GREATEST(booked_count - 1, 0) >= capacity * 0.8 THEN 'LIMITED'::pickup_slot_status
                    ELSE 'AVAILABLE'::pickup_slot_status
                END
            WHERE id = NEW.pickup_slot_id;
        END IF;

        -- 2. Restore inventory
        FOR v_item IN SELECT food_item_id, quantity FROM order_items WHERE order_id = NEW.id
        LOOP
            UPDATE inventory 
            SET quantity_available = quantity_available + v_item.quantity,
                updated_at = NOW()
            WHERE food_item_id = v_item.food_item_id;
        END LOOP;
        
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS release_capacity_on_cancel ON orders;
DROP TRIGGER IF EXISTS restore_capacity_on_cancel ON orders;
DROP FUNCTION IF EXISTS release_pickup_slot_capacity();

CREATE TRIGGER restore_capacity_on_cancel AFTER UPDATE ON orders
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION restore_inventory_and_slots_on_cancel();


-- 4. PERMISSIONS
REVOKE ALL ON FUNCTION place_order(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION place_order(UUID, UUID, TEXT) TO authenticated;

COMMIT;
