-- =============================================================================
-- Migration 003: Harden Gag Backend
-- =============================================================================
-- NON-DESTRUCTIVE. Apply via Supabase Dashboard > SQL Editor.
-- =============================================================================

BEGIN;

-- SECTION 1: HELPER FUNCTIONS (STABLE + explicit search_path)

CREATE OR REPLACE FUNCTION get_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT role::text FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT get_user_role() = 'ADMIN';
$$;

CREATE OR REPLACE FUNCTION is_vendor() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT get_user_role() = 'VENDOR';
$$;

CREATE OR REPLACE FUNCTION is_student() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT get_user_role() = 'STUDENT';
$$;

-- SECTION 2: FIX food_items RLS — is_active -> is_available + boolean precedence fix

DROP POLICY IF EXISTS "Anyone can view active food items"     ON food_items;
DROP POLICY IF EXISTS "Anyone can view available food items"  ON food_items;
DROP POLICY IF EXISTS "Vendors manage their food items"       ON food_items;
DROP POLICY IF EXISTS "Admins have full access to food items" ON food_items;

CREATE POLICY "Anyone can view available food items" ON food_items FOR SELECT USING (
    (
        food_items.is_available = true
        AND EXISTS (SELECT 1 FROM outlets WHERE outlets.id = food_items.outlet_id AND outlets.is_active = true)
    )
    OR is_admin()
    OR (is_vendor() AND EXISTS (SELECT 1 FROM outlets WHERE outlets.id = food_items.outlet_id AND outlets.vendor_id = auth.uid()))
);

CREATE POLICY "Vendors manage their food items" ON food_items FOR ALL USING (
    EXISTS (SELECT 1 FROM outlets WHERE outlets.id = food_items.outlet_id AND outlets.vendor_id = auth.uid())
);

CREATE POLICY "Admins have full access to food items" ON food_items FOR ALL USING (is_admin());

-- SECTION 3: FIX profiles RLS — vendor over-exposure

DROP POLICY IF EXISTS "Vendors can view student profiles attached to their orders" ON profiles;
DROP POLICY IF EXISTS "Vendors view profiles of their order customers"              ON profiles;

CREATE POLICY "Vendors view profiles of their order customers" ON profiles FOR SELECT USING (
    auth.uid() = id
    OR is_admin()
    OR (
        is_vendor()
        AND EXISTS (
            SELECT 1 FROM orders o
            JOIN outlets out ON o.outlet_id = out.id
            WHERE o.user_id = profiles.id AND out.vendor_id = auth.uid()
        )
    )
);

-- SECTION 4: PREVENT PRIVILEGE ESCALATION

CREATE OR REPLACE FUNCTION prevent_role_escalation() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.role IS DISTINCT FROM NEW.role THEN
        IF NOT is_admin() THEN
            RAISE EXCEPTION 'Permission denied: you cannot change your own role.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_role_escalation ON profiles;
CREATE TRIGGER protect_role_escalation BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();

-- SECTION 5: CART INTEGRITY — one cart one outlet

CREATE OR REPLACE FUNCTION enforce_cart_single_outlet() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cart_outlet UUID;
    v_item_outlet UUID;
BEGIN
    SELECT outlet_id INTO v_cart_outlet FROM carts WHERE id = NEW.cart_id;
    SELECT outlet_id INTO v_item_outlet FROM food_items WHERE id = NEW.food_item_id;
    IF v_cart_outlet IS NULL THEN
        UPDATE carts SET outlet_id = v_item_outlet, updated_at = NOW() WHERE id = NEW.cart_id;
        RETURN NEW;
    END IF;
    IF v_cart_outlet != v_item_outlet THEN
        RAISE EXCEPTION 'Cart violation: item outlet (%) != cart outlet (%). Clear cart first.', v_item_outlet, v_cart_outlet;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_single_outlet_per_cart ON cart_items;
CREATE TRIGGER enforce_single_outlet_per_cart BEFORE INSERT OR UPDATE ON cart_items
FOR EACH ROW EXECUTE FUNCTION enforce_cart_single_outlet();

-- SECTION 6: REVOKE INSECURE ORDER INSERT ACCESS

DROP POLICY IF EXISTS "Users create their own orders"              ON orders;
DROP POLICY IF EXISTS "Users create order items"                   ON order_items;
DROP POLICY IF EXISTS "Users create order customizations"          ON order_item_customizations;
DROP POLICY IF EXISTS "Users can cancel their own pending orders"  ON orders;

CREATE POLICY "Users can cancel their own pending orders" ON orders FOR UPDATE
USING (auth.uid() = user_id AND status IN ('CREATED','PLACED'))
WITH CHECK (
    auth.uid() = user_id
    AND NEW.status   = 'CANCELLED'
    AND NEW.user_id   = OLD.user_id
    AND NEW.vendor_id = OLD.vendor_id
    AND NEW.outlet_id = OLD.outlet_id
    AND NEW.subtotal  = OLD.subtotal
    AND NEW.tax       = OLD.tax
    AND NEW.total     = OLD.total
);

-- SECTION 7: ORDER STATE MACHINE

CREATE OR REPLACE FUNCTION enforce_order_state_machine() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
    IF OLD.status = NEW.status THEN RETURN NEW; END IF;
    v_role := get_user_role();
    IF v_role = 'ADMIN' THEN RETURN NEW; END IF;
    IF v_role IS NULL THEN
        IF (OLD.status='CREATED' AND NEW.status='PLACED') OR (OLD.status='READY' AND NEW.status='PICKED_UP')
        THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Unauthorized RPC transition: % -> %', OLD.status, NEW.status;
    END IF;
    IF v_role = 'VENDOR' THEN
        IF (OLD.status='PLACED' AND NEW.status='ACCEPTED') OR
           (OLD.status='ACCEPTED' AND NEW.status='PREPARING') OR
           (OLD.status='PREPARING' AND NEW.status='READY') OR
           (OLD.status='READY' AND NEW.status='PICKED_UP') OR
           (OLD.status IN ('PLACED','ACCEPTED','PREPARING') AND NEW.status='REJECTED')
        THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Invalid vendor transition: % -> %', OLD.status, NEW.status;
    END IF;
    IF v_role = 'STUDENT' THEN
        IF OLD.status IN ('CREATED','PLACED') AND NEW.status='CANCELLED' THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'Invalid student transition: % -> %', OLD.status, NEW.status;
    END IF;
    RAISE EXCEPTION 'Unknown role "%" for transition: % -> %', v_role, OLD.status, NEW.status;
END;
$$;

DROP TRIGGER IF EXISTS order_state_machine ON orders;
CREATE TRIGGER order_state_machine BEFORE UPDATE ON orders
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION enforce_order_state_machine();

-- SECTION 8: ORDER STATUS TIMESTAMPS

CREATE OR REPLACE FUNCTION update_order_status_timestamps() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status='PLACED'    AND OLD.status!='PLACED'    THEN NEW.placed_at    = NOW(); END IF;
    IF NEW.status='ACCEPTED'  AND OLD.status!='ACCEPTED'  THEN NEW.accepted_at  = NOW(); END IF;
    IF NEW.status='PREPARING' AND OLD.status!='PREPARING' THEN NEW.preparing_at = NOW(); END IF;
    IF NEW.status='READY'     AND OLD.status!='READY'     THEN NEW.ready_at     = NOW(); END IF;
    IF NEW.status='PICKED_UP' AND OLD.status!='PICKED_UP' THEN NEW.picked_up_at = NOW(); END IF;
    IF NEW.status='CANCELLED' AND OLD.status!='CANCELLED' THEN NEW.cancelled_at = NOW(); END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_status_timestamps ON orders;
CREATE TRIGGER order_status_timestamps BEFORE UPDATE ON orders
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION update_order_status_timestamps();

-- SECTION 9: pgcrypto for secure random token generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- SECTION 10: ATOMIC ORDER CREATION RPC

CREATE OR REPLACE FUNCTION place_order(
    p_cart_id UUID, p_pickup_slot_id UUID, p_payment_method TEXT DEFAULT 'PAY_AT_COUNTER'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id   UUID := auth.uid();
    v_cart      RECORD; v_outlet RECORD; v_slot RECORD; v_item RECORD;
    v_order_id  UUID;
    v_subtotal  DECIMAL(10,2) := 0;
    v_tax       DECIMAL(10,2) := 0;
    v_total     DECIMAL(10,2) := 0;
    v_prep      INTEGER := 0;
    v_inv_qty   INTEGER;
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

    FOR v_item IN
        SELECT ci.food_item_id, ci.quantity,
               fi.name AS food_name, fi.image_url, fi.price AS db_price,
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

        v_subtotal := v_subtotal + (v_item.db_price * v_item.quantity);
        v_prep     := GREATEST(v_prep, v_item.prep_time_minutes);
    END LOOP;

    v_tax   := ROUND(v_subtotal * 0.05, 2);
    v_total := v_subtotal + v_tax;

    INSERT INTO orders (
        order_number, user_id, vendor_id, outlet_id, pickup_slot_id,
        subtotal, tax, total, status, payment_status, payment_method,
        estimated_prep_minutes, placed_at
    ) VALUES (
        'GAG-' || TO_CHAR(NOW(),'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text,1,6)),
        v_user_id, v_outlet.vendor_id, v_outlet.id, p_pickup_slot_id,
        v_subtotal, v_tax, v_total, 'PLACED', 'PENDING', p_payment_method::payment_method,
        v_prep, NOW()
    ) RETURNING id INTO v_order_id;

    INSERT INTO order_items (order_id, food_item_id, food_name, food_image_url, quantity, unit_price, total_price, is_veg)
    SELECT v_order_id, fi.id, fi.name, fi.image_url, ci.quantity, fi.price, fi.price * ci.quantity, fi.is_veg
    FROM cart_items ci JOIN food_items fi ON ci.food_item_id = fi.id WHERE ci.cart_id = p_cart_id;

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

    INSERT INTO payments (order_id, amount, currency, status)
    VALUES (v_order_id, v_total, 'INR', 'PENDING');

    DELETE FROM cart_items WHERE cart_id = p_cart_id;
    UPDATE carts SET outlet_id=NULL, subtotal=0, tax=0, total=0, updated_at=NOW() WHERE id=p_cart_id;

    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (v_user_id, 'ORDER_PLACED', 'orders', v_order_id,
            jsonb_build_object('outlet_id', v_outlet.id, 'total', v_total));

    RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION place_order(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION place_order(UUID, UUID, TEXT) TO authenticated;

-- SECTION 11: SECURE QR PICKUP VERIFICATION RPC

CREATE OR REPLACE FUNCTION verify_pickup_token(p_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_vendor UUID := auth.uid();
    v_token  RECORD; v_order RECORD; v_outlet RECORD;
BEGIN
    IF get_user_role() != 'VENDOR' THEN RAISE EXCEPTION 'Only vendors can verify pickup tokens.'; END IF;

    SELECT * INTO v_token FROM pickup_tokens WHERE token_value = p_token FOR UPDATE;
    IF NOT FOUND          THEN RAISE EXCEPTION 'Invalid pickup token.'; END IF;
    IF v_token.is_used    THEN RAISE EXCEPTION 'Token already used.'; END IF;
    IF v_token.expires_at < NOW() THEN RAISE EXCEPTION 'Token expired.'; END IF;

    SELECT * INTO v_order FROM orders WHERE id = v_token.order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;

    SELECT * INTO v_outlet FROM outlets WHERE id = v_order.outlet_id AND vendor_id = v_vendor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order does not belong to your outlet.'; END IF;

    IF v_order.status != 'READY' THEN
        RAISE EXCEPTION 'Order not ready for pickup. Status: %', v_order.status;
    END IF;

    UPDATE pickup_tokens SET is_used=true, used_at=NOW() WHERE id=v_token.id;
    UPDATE orders SET status='PICKED_UP', picked_up_at=NOW(), updated_at=NOW() WHERE id=v_order.id;

    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (v_vendor, 'PICKUP_COMPLETED', 'orders', v_order.id,
            jsonb_build_object('order_number', v_order.order_number));

    RETURN jsonb_build_object('success',true,'order_id',v_order.id,'order_number',v_order.order_number,'picked_up_at',NOW());
END;
$$;

REVOKE ALL ON FUNCTION verify_pickup_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verify_pickup_token(TEXT) TO authenticated;

-- SECTION 12: AUTOMATED NOTIFICATIONS ON ORDER STATUS CHANGE

CREATE OR REPLACE FUNCTION notify_order_status_change() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_type notification_type; v_title TEXT; v_body TEXT;
BEGIN
    CASE NEW.status
        WHEN 'ACCEPTED'  THEN v_type:='ORDER_ACCEPTED';  v_title:='✅ Order Accepted!';
                              v_body:='Your order '||NEW.order_number||' was accepted and is being prepared.';
        WHEN 'PREPARING' THEN v_type:='ORDER_PREPARING'; v_title:='👨‍🍳 Being Prepared';
                              v_body:='Your order '||NEW.order_number||' is now being cooked!';
        WHEN 'READY'     THEN v_type:='ORDER_READY';     v_title:='🎉 Ready for Pickup!';
                              v_body:='Your order '||NEW.order_number||' is ready! Come pick it up.';
        WHEN 'CANCELLED' THEN v_type:='ORDER_CANCELLED'; v_title:='🚫 Order Cancelled';
                              v_body:='Your order '||NEW.order_number||' was cancelled.';
        ELSE RETURN NEW;
    END CASE;
    INSERT INTO notifications (user_id, title, body, type, order_id)
    VALUES (NEW.user_id, v_title, v_body, v_type, NEW.id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_status_notification ON orders;
CREATE TRIGGER order_status_notification AFTER UPDATE ON orders
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION notify_order_status_change();

-- SECTION 13: REALTIME PUBLICATIONS

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='orders') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE orders;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='notifications') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    END IF;
END $$;

-- SECTION 14: AUDIT TRIGGERS

CREATE OR REPLACE FUNCTION audit_critical_changes() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), TG_OP, TG_TABLE_NAME, COALESCE(NEW.id, OLD.id),
            CASE WHEN TG_OP!='INSERT' THEN to_jsonb(OLD) ELSE NULL END,
            CASE WHEN TG_OP!='DELETE' THEN to_jsonb(NEW) ELSE NULL END);
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_order_changes     ON orders;
DROP TRIGGER IF EXISTS audit_inventory_changes ON inventory;
CREATE TRIGGER audit_order_changes     AFTER INSERT OR UPDATE OF status ON orders    FOR EACH ROW EXECUTE FUNCTION audit_critical_changes();
CREATE TRIGGER audit_inventory_changes AFTER UPDATE                     ON inventory FOR EACH ROW EXECUTE FUNCTION audit_critical_changes();

-- SECTION 15: MISSING PERFORMANCE INDEXES

CREATE INDEX IF NOT EXISTS idx_cart_items_cart       ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_food_items_available  ON food_items(is_available);
CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pickup_slots_time     ON pickup_slots(start_time);
CREATE INDEX IF NOT EXISTS idx_notifications_unread  ON notifications(user_id, is_read);

COMMIT;

-- =============================================================================
-- SUPABASE DASHBOARD — MANUAL STEPS AFTER RUNNING THIS MIGRATION
-- =============================================================================
-- 1. Storage > New Bucket:
--    - food-images    (Public)
--    - outlet-images  (Public)
--    - profile-images (Private — use signed URLs)
--
-- 2. Storage > Policies — restrict upload to owners/vendors.
--
-- 3. Database > Replication — confirm 'orders' and 'notifications' are enabled.
-- =============================================================================
