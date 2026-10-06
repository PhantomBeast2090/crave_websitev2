-- ============================================================================
-- 019_payment_and_ordering.sql
--
-- Server-authoritative ordering and the Razorpay state machine.
--
--  * place_order: validates customizations, decrements stock atomically per
--    line (the old single UPDATE ... FROM only applied ONE row when the same
--    food appeared twice in a cart => oversell), enforces IST slot rules,
--    clears the cart for both payment methods and refuses a second online
--    order while one is still awaiting payment (idempotent double-click guard).
--  * Unpaid online orders expire after 15 minutes and give stock + slot back.
--  * Razorpay confirmations go through crave_payment_apply(): idempotent,
--    amount-checked, never downgrades a paid order, usable by both the verify
--    endpoint and the webhook (in any order, any number of times).
--  * Student / vendor order actions are SECURITY INVOKER wrappers, so RLS and
--    crave_guard_order_update() (018) stay the single source of truth.
-- ============================================================================

BEGIN;

-- Backfill: abandoned online orders created before this migration get a
-- deadline so the first expiry sweep can release their stock and slots.
UPDATE orders SET payment_expires_at = created_at + interval '15 minutes'
WHERE payment_method::text = 'ONLINE'
  AND payment_status::text IN ('PENDING', 'CREATED', 'AUTHORIZED', 'FAILED')
  AND payment_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_unpaid_online ON orders (payment_expires_at) WHERE payment_expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_razorpay_order ON payments (razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_razorpay_payment ON payments (razorpay_payment_id)
    WHERE razorpay_payment_id IS NOT NULL AND status IN ('PAID', 'CAPTURED', 'REFUNDED');

-- ---------------------------------------------------------------------------
-- Expiry sweep
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crave_expire_unpaid_orders(p_user uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
    WITH expired AS (
        UPDATE orders SET status = 'CANCELLED',
            cancellation_reason = 'Payment was not completed in time.',
            cancelled_at = now(), updated_at = now()
        WHERE payment_method::text = 'ONLINE'
          AND status::text IN ('CREATED', 'PLACED')
          AND payment_status::text IN ('PENDING', 'CREATED', 'AUTHORIZED', 'FAILED')
          AND payment_expires_at IS NOT NULL AND payment_expires_at < now()
          AND (p_user IS NULL OR user_id = p_user)
        RETURNING 1)
    SELECT count(*) INTO v_count FROM expired;
    RETURN v_count;
END $$;
SELECT crave_lock_function('crave_expire_unpaid_orders(uuid)', ARRAY['service_role']);

-- ---------------------------------------------------------------------------
-- place_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION place_order(
    p_cart_id UUID, p_pickup_slot_id UUID, p_payment_method TEXT DEFAULT 'PAY_AT_COUNTER'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_user_id   UUID := auth.uid();
    v_cart      RECORD; v_outlet RECORD; v_slot RECORD; v_item RECORD; v_var RECORD;
    v_cust      RECORD;
    v_order_id  UUID;
    v_subtotal  DECIMAL(10,2) := 0;
    v_tax       DECIMAL(10,2);
    v_total     DECIMAL(10,2);
    v_prep      INTEGER := 0;
    v_item_subtotal DECIMAL(10,2);
    v_order_item_id UUID;
    v_ist_now   TIMESTAMP := NOW() AT TIME ZONE 'Asia/Kolkata';
    v_pending   UUID;
    v_lines     INTEGER;
    v_sel       INTEGER;
    v_valid     INTEGER;
    v_distinct  INTEGER;
    v_is_online BOOLEAN;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
    IF NOT crave_is_active_user() OR get_user_role() IS DISTINCT FROM 'STUDENT' THEN
        RAISE EXCEPTION 'Only active student accounts can place orders.';
    END IF;
    IF p_payment_method NOT IN ('PAY_AT_COUNTER', 'ONLINE') THEN
        RAISE EXCEPTION 'Unsupported payment method.';
    END IF;
    v_is_online := p_payment_method = 'ONLINE';

    -- Serialise concurrent checkouts of the same cart (double click / 2 tabs).
    SELECT * INTO v_cart FROM carts WHERE id = p_cart_id AND user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cart not found or not owned by user.'; END IF;

    PERFORM crave_expire_unpaid_orders(v_user_id);

    SELECT count(*) INTO v_lines FROM cart_items WHERE cart_id = p_cart_id;
    IF v_lines = 0 THEN RAISE EXCEPTION 'Cart is empty.'; END IF;
    IF v_lines > 30 THEN RAISE EXCEPTION 'Too many items in one order.'; END IF;

    -- One unpaid online order at a time: resume or cancel it first.
    SELECT id INTO v_pending FROM orders
    WHERE user_id = v_user_id AND payment_method::text = 'ONLINE' AND status::text IN ('CREATED', 'PLACED')
      AND payment_status::text IN ('PENDING', 'CREATED', 'AUTHORIZED', 'FAILED')
    ORDER BY created_at DESC LIMIT 1;
    IF v_pending IS NOT NULL THEN
        RAISE EXCEPTION 'PAYMENT_IN_PROGRESS:%', v_pending;
    END IF;

    SELECT * INTO v_outlet FROM outlets WHERE id = v_cart.outlet_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Outlet not found.'; END IF;
    IF NOT v_outlet.is_active THEN RAISE EXCEPTION 'Outlet is not active.'; END IF;

    SELECT * INTO v_slot FROM pickup_slots
    WHERE id = p_pickup_slot_id AND outlet_id = v_cart.outlet_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pickup slot not found for this outlet.'; END IF;
    IF v_slot.slot_date < v_ist_now::DATE THEN RAISE EXCEPTION 'Pickup slot is in the past.'; END IF;
    IF v_slot.slot_date > v_ist_now::DATE + 7 THEN RAISE EXCEPTION 'Pickup slot is too far in the future.'; END IF;
    IF v_slot.slot_date = v_ist_now::DATE THEN
        IF v_slot.start_time <= v_ist_now::TIME THEN RAISE EXCEPTION 'Pickup slot time has already passed.'; END IF;
        IF NOT v_outlet.is_open THEN RAISE EXCEPTION 'Outlet is currently closed.'; END IF;
    END IF;
    IF v_slot.status::text NOT IN ('AVAILABLE', 'LIMITED') THEN RAISE EXCEPTION 'Pickup slot is not available.'; END IF;
    IF v_slot.booked_count >= v_slot.capacity THEN RAISE EXCEPTION 'Pickup slot is full.'; END IF;

    INSERT INTO orders (
        order_number, user_id, vendor_id, outlet_id, pickup_slot_id,
        subtotal, tax, total, status, payment_status, payment_method,
        estimated_prep_minutes, placed_at, payment_expires_at
    ) VALUES (
        'GAG-' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Kolkata', 'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text, 1, 6)),
        v_user_id, v_outlet.vendor_id, v_outlet.id, p_pickup_slot_id,
        0, 0, 0, 'PLACED', 'PENDING', p_payment_method::payment_method,
        0, NOW(), CASE WHEN v_is_online THEN NOW() + interval '15 minutes' END
    ) RETURNING id INTO v_order_id;

    FOR v_item IN
        SELECT ci.id AS cart_item_id, ci.food_item_id, ci.quantity, ci.special_instructions,
               fi.name AS food_name, fi.image_url, fi.price AS base_price,
               fi.is_veg, fi.is_available, fi.prep_time_minutes, fi.outlet_id AS item_outlet, fi.deleted_at
        FROM cart_items ci JOIN food_items fi ON ci.food_item_id = fi.id
        WHERE ci.cart_id = p_cart_id
        ORDER BY ci.food_item_id, ci.id          -- stable lock order => no deadlocks
    LOOP
        IF v_item.item_outlet <> v_cart.outlet_id THEN RAISE EXCEPTION 'Cart integrity error.'; END IF;
        IF NOT v_item.is_available OR v_item.deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Item "%" is unavailable.', v_item.food_name;
        END IF;
        IF v_item.quantity <= 0 OR v_item.quantity > 20 THEN
            RAISE EXCEPTION 'Invalid quantity for "%".', v_item.food_name;
        END IF;

        -- Customizations: every row must belong to this food, required groups
        -- must be answered and max_selections respected.
        SELECT count(*), count(DISTINCT option_id) INTO v_sel, v_distinct
        FROM cart_item_customizations WHERE cart_item_id = v_item.cart_item_id;
        SELECT count(*) INTO v_valid
        FROM cart_item_customizations cic
        JOIN food_variants fv ON fv.id = cic.variant_id AND fv.food_item_id = v_item.food_item_id
        JOIN food_variant_options fvo ON fvo.id = cic.option_id AND fvo.variant_id = fv.id
        WHERE cic.cart_item_id = v_item.cart_item_id;
        IF v_sel <> v_valid OR v_sel <> v_distinct THEN
            RAISE EXCEPTION 'Invalid customization for "%".', v_item.food_name;
        END IF;
        FOR v_var IN
            SELECT fv.name, fv.is_required, fv.max_selections,
                   (SELECT count(*) FROM cart_item_customizations c
                     WHERE c.cart_item_id = v_item.cart_item_id AND c.variant_id = fv.id) AS picked
            FROM food_variants fv WHERE fv.food_item_id = v_item.food_item_id
        LOOP
            IF v_var.is_required AND v_var.picked = 0 THEN
                RAISE EXCEPTION 'Please choose "%" for "%".', v_var.name, v_item.food_name;
            END IF;
            IF v_var.picked > v_var.max_selections THEN
                RAISE EXCEPTION 'Too many "%" choices for "%".', v_var.name, v_item.food_name;
            END IF;
        END LOOP;

        -- Atomic per-line stock decrement (check + update in one statement).
        UPDATE inventory SET quantity_available = quantity_available - v_item.quantity, updated_at = NOW()
        WHERE food_item_id = v_item.food_item_id AND quantity_available >= v_item.quantity;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Insufficient stock for "%".', v_item.food_name;
        END IF;

        v_item_subtotal := v_item.base_price;
        INSERT INTO order_items (order_id, food_item_id, food_name, food_image_url, quantity, unit_price, total_price, is_veg, special_instructions)
        VALUES (v_order_id, v_item.food_item_id, v_item.food_name, v_item.image_url, v_item.quantity,
                v_item.base_price, v_item.base_price * v_item.quantity, v_item.is_veg, LEFT(v_item.special_instructions, 200))
        RETURNING id INTO v_order_item_id;

        FOR v_cust IN
            SELECT fv.name AS variant_name, fvo.name AS option_name, fvo.extra_price
            FROM cart_item_customizations cic
            JOIN food_variants fv ON fv.id = cic.variant_id
            JOIN food_variant_options fvo ON fvo.id = cic.option_id
            WHERE cic.cart_item_id = v_item.cart_item_id
        LOOP
            v_item_subtotal := v_item_subtotal + v_cust.extra_price;
            INSERT INTO order_item_customizations (order_item_id, variant_name, option_name, extra_price)
            VALUES (v_order_item_id, v_cust.variant_name, v_cust.option_name, v_cust.extra_price);
        END LOOP;

        UPDATE order_items SET unit_price = v_item_subtotal, total_price = v_item_subtotal * v_item.quantity
        WHERE id = v_order_item_id;

        v_subtotal := v_subtotal + (v_item_subtotal * v_item.quantity);
        v_prep     := GREATEST(v_prep, COALESCE(v_item.prep_time_minutes, 0));
    END LOOP;

    v_tax   := ROUND(v_subtotal * 0.05, 2);
    v_total := v_subtotal + v_tax;
    IF v_is_online AND v_total < 1 THEN RAISE EXCEPTION 'Order total is too small for online payment.'; END IF;

    UPDATE orders SET subtotal = v_subtotal, tax = v_tax, total = v_total, estimated_prep_minutes = v_prep
    WHERE id = v_order_id;

    UPDATE pickup_slots SET booked_count = booked_count + 1,
        status = CASE
            WHEN booked_count + 1 >= capacity       THEN 'FULL'::pickup_slot_status
            WHEN booked_count + 1 >= capacity * 0.8 THEN 'LIMITED'::pickup_slot_status
            ELSE 'AVAILABLE'::pickup_slot_status END
    WHERE id = p_pickup_slot_id AND booked_count < capacity;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pickup slot is full.'; END IF;

    INSERT INTO pickup_tokens (order_id, token_value, expires_at)
    VALUES (v_order_id, encode(extensions.gen_random_bytes(32), 'hex'), NOW() + INTERVAL '3 hours');

    INSERT INTO payments (order_id, amount, currency, status, gateway_provider)
    VALUES (v_order_id, v_total, 'INR', 'PENDING',
            CASE WHEN v_is_online THEN 'RAZORPAY'::payment_provider ELSE 'CASH'::payment_provider END)
    ON CONFLICT (order_id) DO UPDATE SET amount = EXCLUDED.amount, gateway_provider = EXCLUDED.gateway_provider;

    -- The cart is consumed by the order for BOTH methods; a failed or cancelled
    -- online payment never leaves a stale server cart behind.
    DELETE FROM cart_items WHERE cart_id = p_cart_id;
    UPDATE carts SET outlet_id = NULL, subtotal = 0, tax = 0, total = 0, updated_at = NOW() WHERE id = p_cart_id;

    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (v_user_id, 'ORDER_PLACED', 'orders', v_order_id,
            jsonb_build_object('outlet_id', v_outlet.id, 'total', v_total, 'method', p_payment_method));

    RETURN v_order_id;
END;
$$;
SELECT crave_lock_function('place_order(uuid,uuid,text)', ARRAY['authenticated', 'service_role']);

-- ---------------------------------------------------------------------------
-- Razorpay state machine (service role only)
-- ---------------------------------------------------------------------------

-- Validates that `p_user` may pay `p_order` right now and returns what the
-- Edge Function needs to create (or reuse) the Razorpay order.
CREATE OR REPLACE FUNCTION crave_payment_prepare(p_order_id uuid, p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v record;
BEGIN
    PERFORM crave_expire_unpaid_orders(p_user_id);
    SELECT o.id, o.user_id, o.status::text AS ostatus, o.payment_method::text AS method,
           o.payment_status::text AS opay, o.payment_expires_at,
           p.id AS payment_id, p.amount, p.status::text AS pstatus, p.razorpay_order_id
      INTO v
      FROM orders o JOIN payments p ON p.order_id = o.id
     WHERE o.id = p_order_id FOR UPDATE OF p;
    IF NOT FOUND OR v.user_id <> p_user_id THEN RAISE EXCEPTION 'Order not found.'; END IF;
    IF v.method <> 'ONLINE' THEN RAISE EXCEPTION 'This order is not an online-payment order.'; END IF;
    IF v.pstatus IN ('PAID', 'CAPTURED', 'REFUNDED') OR v.opay IN ('PAID', 'CAPTURED', 'REFUNDED') THEN
        RAISE EXCEPTION 'This order has already been paid.';
    END IF;
    IF v.ostatus NOT IN ('CREATED', 'PLACED') THEN RAISE EXCEPTION 'This order can no longer be paid.'; END IF;
    IF v.payment_expires_at IS NOT NULL AND v.payment_expires_at < now() THEN
        RAISE EXCEPTION 'This order has expired. Please place it again.';
    END IF;
    RETURN jsonb_build_object(
        'order_id', v.id,
        'amount_paise', round(v.amount * 100)::bigint,
        'razorpay_order_id', v.razorpay_order_id,
        'expires_at', v.payment_expires_at);
END $$;
SELECT crave_lock_function('crave_payment_prepare(uuid,uuid)', ARRAY['service_role']);

-- Compare-and-set the Razorpay order id; returns the id that won the race.
CREATE OR REPLACE FUNCTION crave_payment_attach(p_order_id uuid, p_razorpay_order_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_existing text;
BEGIN
    UPDATE payments SET razorpay_order_id = p_razorpay_order_id, gateway_provider = 'RAZORPAY',
           status = CASE WHEN status::text IN ('PENDING', 'FAILED') THEN 'CREATED'::payment_status ELSE status END,
           updated_at = now()
    WHERE order_id = p_order_id AND razorpay_order_id IS NULL
      AND status::text NOT IN ('PAID', 'CAPTURED', 'REFUNDED');
    SELECT razorpay_order_id INTO v_existing FROM payments WHERE order_id = p_order_id;
    RETURN v_existing;
END $$;
SELECT crave_lock_function('crave_payment_attach(uuid,text)', ARRAY['service_role']);

-- Single entry point for "money state changed". Safe to call repeatedly, from
-- the verify endpoint and the webhook, in any order.
CREATE OR REPLACE FUNCTION crave_payment_apply(
    p_razorpay_order_id text, p_razorpay_payment_id text, p_status text,
    p_amount_paise bigint DEFAULT NULL, p_signature text DEFAULT NULL, p_expected_user uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    p record; o record;
    v_new text := upper(p_status);
    v_changed boolean := false;
    v_ostatus text; v_opay text;
BEGIN
    SELECT * INTO p FROM payments WHERE razorpay_order_id = p_razorpay_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown Razorpay order.'; END IF;
    SELECT * INTO o FROM orders WHERE id = p.order_id FOR UPDATE;
    IF p_expected_user IS NOT NULL AND o.user_id <> p_expected_user THEN
        RAISE EXCEPTION 'Order not found.';
    END IF;
    IF p_amount_paise IS NOT NULL AND p_amount_paise <> round(p.amount * 100)::bigint THEN
        INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
        VALUES (NULL, 'PAYMENT_AMOUNT_MISMATCH', 'payments', p.id,
                jsonb_build_object('expected', round(p.amount * 100), 'got', p_amount_paise, 'payment', p_razorpay_payment_id));
        RAISE EXCEPTION 'Payment amount mismatch.';
    END IF;

    IF p.status::text IN ('PAID', 'CAPTURED', 'REFUNDED') THEN
        IF v_new IN ('PAID', 'CAPTURED') AND p.razorpay_payment_id IS DISTINCT FROM p_razorpay_payment_id THEN
            INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
            VALUES (NULL, 'DUPLICATE_PAYMENT', 'payments', p.id,
                    jsonb_build_object('kept', p.razorpay_payment_id, 'extra', p_razorpay_payment_id));
        END IF;
    ELSIF v_new IN ('PAID', 'CAPTURED') THEN
        UPDATE payments SET status = 'PAID', razorpay_payment_id = p_razorpay_payment_id,
               razorpay_signature = COALESCE(p_signature, razorpay_signature), paid_at = now(), updated_at = now()
        WHERE id = p.id;
        UPDATE orders SET payment_status = 'PAID', updated_at = now() WHERE id = o.id;
        v_changed := true;
    ELSIF v_new = 'FAILED' THEN
        -- A failed attempt does not kill the order: Razorpay lets the student
        -- retry on the same order until it expires.
        UPDATE payments SET status = 'FAILED', updated_at = now() WHERE id = p.id;
        UPDATE orders SET payment_status = 'FAILED', updated_at = now() WHERE id = o.id;
        v_changed := true;
    ELSIF v_new = 'AUTHORIZED' THEN
        UPDATE payments SET status = 'AUTHORIZED', razorpay_payment_id = p_razorpay_payment_id, updated_at = now() WHERE id = p.id;
        UPDATE orders SET payment_status = 'AUTHORIZED', updated_at = now() WHERE id = o.id;
        v_changed := true;
    END IF;

    SELECT status::text, payment_status::text INTO v_ostatus, v_opay FROM orders WHERE id = o.id;
    RETURN jsonb_build_object('order_id', o.id, 'order_status', v_ostatus, 'payment_status', v_opay, 'changed', v_changed);
END $$;
SELECT crave_lock_function('crave_payment_apply(text,text,text,bigint,text,uuid)', ARRAY['service_role']);

-- Backwards-compatible wrapper (service role only now).
CREATE OR REPLACE FUNCTION mark_payment_verified(
    p_order_id UUID, p_razorpay_payment_id TEXT, p_razorpay_signature TEXT, p_status payment_status DEFAULT 'PAID'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rzp text;
BEGIN
    SELECT razorpay_order_id INTO v_rzp FROM payments WHERE order_id = p_order_id;
    IF v_rzp IS NULL THEN RAISE EXCEPTION 'No Razorpay order for this order.'; END IF;
    PERFORM crave_payment_apply(v_rzp, p_razorpay_payment_id, p_status::text, NULL, p_razorpay_signature, NULL);
END $$;
SELECT crave_lock_function('mark_payment_verified(uuid,text,text,payment_status)', ARRAY['service_role']);

-- Staff refund bookkeeping (after the Razorpay refund API call succeeded).
CREATE OR REPLACE FUNCTION crave_payment_mark_refunded(p_order_id uuid, p_refund_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE payments SET status = 'REFUNDED', updated_at = now()
    WHERE order_id = p_order_id AND status::text IN ('PAID', 'CAPTURED');
    IF NOT FOUND THEN RAISE EXCEPTION 'No captured payment to refund.'; END IF;
    UPDATE orders SET payment_status = 'REFUNDED', updated_at = now() WHERE id = p_order_id;
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (NULL, 'PAYMENT_REFUNDED', 'orders', p_order_id, jsonb_build_object('refund_id', p_refund_id));
END $$;
SELECT crave_lock_function('crave_payment_mark_refunded(uuid,text)', ARRAY['service_role']);

-- Pay-at-counter orders are settled in cash when the vendor hands the food over.
CREATE OR REPLACE FUNCTION crave_settle_cash_on_pickup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.status::text = 'PICKED_UP' AND OLD.status::text <> 'PICKED_UP'
       AND NEW.payment_method::text = 'PAY_AT_COUNTER' AND NEW.payment_status::text = 'PENDING' THEN
        UPDATE payments SET status = 'PAID', paid_at = now(), updated_at = now() WHERE order_id = NEW.id AND status::text = 'PENDING';
        UPDATE orders SET payment_status = 'PAID' WHERE id = NEW.id;
    END IF;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS crave_cash_settlement ON orders;
CREATE TRIGGER crave_cash_settlement AFTER UPDATE OF status ON orders
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION crave_settle_cash_on_pickup();

-- ---------------------------------------------------------------------------
-- Role-checked order actions (SECURITY INVOKER: RLS + guard trigger apply)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crave_set_order_status(p_order_id uuid, p_to text, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
    UPDATE orders SET status = p_to::order_status,
           cancellation_reason = COALESCE(LEFT(NULLIF(trim(p_reason), ''), 300), cancellation_reason)
     WHERE id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
END $$;

CREATE OR REPLACE FUNCTION cancel_my_order(p_order_id uuid, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
    SELECT crave_set_order_status(p_order_id, 'CANCELLED', COALESCE(p_reason, 'Cancelled by student'))
$$;
CREATE OR REPLACE FUNCTION vendor_accept_order(p_order_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT crave_set_order_status(p_order_id, 'ACCEPTED') $$;
CREATE OR REPLACE FUNCTION vendor_start_preparing(p_order_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT crave_set_order_status(p_order_id, 'PREPARING') $$;
CREATE OR REPLACE FUNCTION vendor_mark_ready(p_order_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT crave_set_order_status(p_order_id, 'READY') $$;
CREATE OR REPLACE FUNCTION vendor_reject_order(p_order_id uuid, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT crave_set_order_status(p_order_id, 'REJECTED', COALESCE(p_reason, 'Rejected by outlet')) $$;
CREATE OR REPLACE FUNCTION admin_cancel_order(p_order_id uuid, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT crave_set_order_status(p_order_id, 'CANCELLED', COALESCE(p_reason, 'Cancelled by management')) $$;

-- Scan a student's QR token at the counter (READY -> PICKED_UP).
CREATE OR REPLACE FUNCTION verify_pickup_token(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_tok record; v_order record;
BEGIN
    IF get_user_role() IS DISTINCT FROM 'VENDOR' THEN RAISE EXCEPTION 'Only vendors can verify pickup tokens.'; END IF;
    SELECT * INTO v_tok FROM pickup_tokens WHERE token_value = p_token FOR UPDATE;   -- RLS: own outlets only
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid pickup token.'; END IF;
    IF v_tok.is_used THEN RAISE EXCEPTION 'Token already used.'; END IF;
    IF v_tok.expires_at < now() THEN RAISE EXCEPTION 'Token expired.'; END IF;
    SELECT * INTO v_order FROM orders WHERE id = v_tok.order_id;
    IF v_order.status::text <> 'READY' THEN RAISE EXCEPTION 'Order is not ready for pickup (status: %).', v_order.status; END IF;
    UPDATE pickup_tokens SET is_used = true, used_at = now() WHERE id = v_tok.id;
    UPDATE orders SET status = 'PICKED_UP' WHERE id = v_order.id;
    RETURN jsonb_build_object('success', true, 'order_id', v_order.id, 'order_number', v_order.order_number);
END $$;

SELECT crave_lock_function('crave_set_order_status(uuid,text,text)', ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('cancel_my_order(uuid,text)',            ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('vendor_accept_order(uuid)',             ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('vendor_start_preparing(uuid)',          ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('vendor_mark_ready(uuid)',               ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('vendor_reject_order(uuid,text)',        ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('admin_cancel_order(uuid,text)',         ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('verify_pickup_token(text)',             ARRAY['authenticated', 'service_role']);

-- Optional: periodic sweep when pg_cron is available (no-op otherwise).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('crave-expire-unpaid-orders', '*/5 * * * *', 'SELECT public.crave_expire_unpaid_orders()');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END $$;

COMMIT;
