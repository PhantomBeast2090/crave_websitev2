-- ============================================================================
-- 018_security_hardening.sql
--
-- Closes the privilege-escalation / payment-tampering holes found by the
-- website audit (all reproduced against the live project with the three test
-- accounts before this migration was written):
--
--   1. Any signed-in user could `UPDATE profiles SET role='VENDOR'|'ADMIN'`.
--   2. Students could set `orders.payment_status = 'PAID'` on their own order
--      (and change any other column that RLS did not pin).
--   3. `mark_payment_verified()` was executable by `anon`: Supabase's default
--      privileges grant EXECUTE on every new public function to anon and
--      authenticated, so `REVOKE ... FROM PUBLIC` in earlier migrations never
--      removed that access.
--   4. Any vendor could read every profile (names + emails, incl. admins).
--   5. Students could not read their own pickup token (so the QR was fake),
--      while vendors had unrestricted write access to tokens.
--
-- The migration is written to be IDEMPOTENT and DEFENSIVE: the live database
-- was provisioned with a different subset of the earlier migrations than the
-- repository contains (e.g. 003 and 008 never applied), so instead of
-- assuming which policies exist it drops every policy on the tables it takes
-- over and recreates the full, intended set.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------

-- True when the statement runs as the DB owner / service role, i.e. from inside
-- a SECURITY DEFINER function or an Edge Function using the service key. Direct
-- PostgREST traffic always runs as `anon` or `authenticated`.
CREATE OR REPLACE FUNCTION crave_is_internal() RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT current_user IN ('postgres', 'supabase_admin', 'service_role')
$$;

-- Ownership check used by policies and RPCs: caller owns the outlet.
CREATE OR REPLACE FUNCTION crave_owns_outlet(p_outlet_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM outlets o
        WHERE o.id = p_outlet_id AND o.vendor_id = auth.uid()
    ) AND COALESCE(get_user_role(), '') = 'VENDOR'
$$;

-- Active-account check (disabled accounts keep their rows but lose access).
CREATE OR REPLACE FUNCTION crave_is_active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((SELECT is_active FROM profiles WHERE id = auth.uid()), false)
$$;

-- Drop every policy on a table so the intended set can be recreated.
CREATE OR REPLACE FUNCTION crave_drop_all_policies(p_table text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
    FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = p_table LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, p_table);
    END LOOP;
END $$;

-- Remove the default Supabase grants from a function and give it only to the
-- roles listed. Works for any signature; silently skips functions that do not
-- exist on this database.
CREATE OR REPLACE FUNCTION crave_lock_function(p_signature text, p_roles text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_oid regprocedure; v_role text;
BEGIN
    v_oid := to_regprocedure(p_signature);
    IF v_oid IS NULL THEN RETURN; END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_oid);
    FOREACH v_role IN ARRAY p_roles LOOP
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', v_oid, v_role);
    END LOOP;
END $$;

-- Schema additions used by the payment flow (kept here so 018 alone is enough
-- to make the guards below valid).
ALTER TABLE orders   ADD COLUMN IF NOT EXISTS payment_expires_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS special_instructions text;

-- ---------------------------------------------------------------------------
-- 1. profiles: no self role escalation, vendors only see their customers
-- ---------------------------------------------------------------------------
SELECT crave_drop_all_policies('profiles');

CREATE POLICY profiles_select_own    ON profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY profiles_select_admin  ON profiles FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY profiles_select_vendor_customers ON profiles FOR SELECT TO authenticated USING (
    is_vendor() AND EXISTS (
        SELECT 1 FROM orders o JOIN outlets ou ON ou.id = o.outlet_id
        WHERE o.user_id = profiles.id AND ou.vendor_id = auth.uid()
    )
);
-- Self-registration may only create STUDENT or PENDING_VENDOR profiles.
CREATE POLICY profiles_insert_own ON profiles FOR INSERT TO authenticated
    WITH CHECK (id = auth.uid() AND role::text IN ('STUDENT', 'PENDING_VENDOR'));
CREATE POLICY profiles_update_own   ON profiles FOR UPDATE TO authenticated
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_admin ON profiles FOR UPDATE TO authenticated
    USING (is_admin()) WITH CHECK (is_admin());

CREATE OR REPLACE FUNCTION crave_guard_profile_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF crave_is_internal() THEN RETURN NEW; END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Profile id cannot be changed.' USING ERRCODE = '42501';
    END IF;
    IF NOT is_admin() THEN
        IF NEW.role IS DISTINCT FROM OLD.role
           OR NEW.is_active IS DISTINCT FROM OLD.is_active
           OR NEW.email IS DISTINCT FROM OLD.email THEN
            RAISE EXCEPTION 'You cannot change your own role, status or email.' USING ERRCODE = '42501';
        END IF;
    ELSIF NEW.id = auth.uid() AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
        RAISE EXCEPTION 'Administrators cannot change their own role or status.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crave_profile_guard ON profiles;
CREATE TRIGGER crave_profile_guard BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION crave_guard_profile_update();

REVOKE DELETE ON profiles FROM anon, authenticated;
REVOKE ALL ON profiles FROM anon;

-- ---------------------------------------------------------------------------
-- 2. orders: read-only for clients; status changes only along legal edges
-- ---------------------------------------------------------------------------
SELECT crave_drop_all_policies('orders');

CREATE POLICY orders_select_own ON orders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY orders_select_vendor ON orders FOR SELECT TO authenticated USING (
    crave_owns_outlet(outlet_id)
    AND (payment_method::text = 'PAY_AT_COUNTER'
         OR payment_status::text IN ('PAID', 'CAPTURED', 'REFUNDED')
         OR status::text IN ('REJECTED', 'CANCELLED', 'EXPIRED'))
);
CREATE POLICY orders_select_admin ON orders FOR SELECT TO authenticated USING (is_admin());
-- UPDATE stays available so legacy clients that patch `status` keep working,
-- but crave_guard_order_update() below pins everything except legal transitions.
CREATE POLICY orders_update_own ON orders FOR UPDATE TO authenticated
    USING (user_id = auth.uid() AND status::text IN ('CREATED', 'PLACED'))
    WITH CHECK (user_id = auth.uid());
CREATE POLICY orders_update_vendor ON orders FOR UPDATE TO authenticated
    USING (crave_owns_outlet(outlet_id)) WITH CHECK (crave_owns_outlet(outlet_id));
CREATE POLICY orders_update_admin ON orders FOR UPDATE TO authenticated
    USING (is_admin()) WITH CHECK (is_admin());

REVOKE INSERT, DELETE, TRUNCATE ON orders FROM anon, authenticated;
REVOKE ALL ON orders FROM anon;

CREATE OR REPLACE FUNCTION crave_guard_order_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    v_role text;
    v_paid boolean;
    v_ok   boolean := false;
BEGIN
    IF crave_is_internal() THEN RETURN NEW; END IF;

    -- Money / identity / routing columns are server-owned.
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.order_number IS DISTINCT FROM OLD.order_number
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.vendor_id IS DISTINCT FROM OLD.vendor_id
       OR NEW.outlet_id IS DISTINCT FROM OLD.outlet_id
       OR NEW.pickup_slot_id IS DISTINCT FROM OLD.pickup_slot_id
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.tax IS DISTINCT FROM OLD.tax
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_expires_at IS DISTINCT FROM OLD.payment_expires_at
       OR NEW.placed_at IS DISTINCT FROM OLD.placed_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Protected order fields can only be changed by the server.' USING ERRCODE = '42501';
    END IF;

    v_role := get_user_role();
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'No Crave profile for this account.' USING ERRCODE = '42501';
    END IF;

    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        -- Non-status edits: only the owning vendor / admin may touch prep notes.
        IF v_role = 'STUDENT' AND (
               NEW.cancellation_reason IS DISTINCT FROM OLD.cancellation_reason
            OR NEW.estimated_prep_minutes IS DISTINCT FROM OLD.estimated_prep_minutes
            OR NEW.actual_prep_minutes IS DISTINCT FROM OLD.actual_prep_minutes
            OR NEW.special_instructions IS DISTINCT FROM OLD.special_instructions) THEN
            RAISE EXCEPTION 'Students cannot edit order details after placing it.' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;

    v_paid := OLD.payment_status::text IN ('PAID', 'CAPTURED');

    IF v_role = 'STUDENT' THEN
        IF OLD.user_id <> auth.uid() THEN
            RAISE EXCEPTION 'Not your order.' USING ERRCODE = '42501';
        END IF;
        -- A paid online order needs a refund, which is handled by staff.
        v_ok := OLD.status::text IN ('CREATED', 'PLACED') AND NEW.status::text = 'CANCELLED' AND NOT v_paid;
    ELSIF v_role IN ('VENDOR', 'ADMIN') THEN
        IF v_role = 'VENDOR' AND NOT crave_owns_outlet(OLD.outlet_id) THEN
            RAISE EXCEPTION 'Not your outlet.' USING ERRCODE = '42501';
        END IF;
        v_ok := (OLD.status::text = 'PLACED'    AND NEW.status::text = 'ACCEPTED')
             OR (OLD.status::text = 'ACCEPTED'  AND NEW.status::text = 'PREPARING')
             OR (OLD.status::text = 'PREPARING' AND NEW.status::text = 'READY')
             OR (OLD.status::text = 'READY'     AND NEW.status::text = 'PICKED_UP')
             OR (OLD.status::text IN ('PLACED', 'ACCEPTED', 'PREPARING') AND NEW.status::text = 'REJECTED')
             OR (v_role = 'ADMIN' AND OLD.status::text IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY') AND NEW.status::text = 'CANCELLED');
        -- Never start cooking an online order that has not been paid.
        IF v_ok AND NEW.status::text IN ('ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP')
           AND OLD.payment_method::text = 'ONLINE' AND NOT v_paid THEN
            RAISE EXCEPTION 'This online order has not been paid yet.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF NOT v_ok THEN
        RAISE EXCEPTION 'Illegal order transition % -> % for role %', OLD.status, NEW.status, v_role USING ERRCODE = '42501';
    END IF;

    IF NEW.status::text = 'ACCEPTED'  THEN NEW.accepted_at  := COALESCE(NEW.accepted_at,  now()); END IF;
    IF NEW.status::text = 'PREPARING' THEN NEW.preparing_at := COALESCE(NEW.preparing_at, now()); END IF;
    IF NEW.status::text = 'READY'     THEN NEW.ready_at     := COALESCE(NEW.ready_at,     now()); END IF;
    IF NEW.status::text = 'PICKED_UP' THEN NEW.picked_up_at := COALESCE(NEW.picked_up_at, now()); END IF;
    IF NEW.status::text IN ('CANCELLED', 'REJECTED') THEN NEW.cancelled_at := COALESCE(NEW.cancelled_at, now()); END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crave_order_guard ON orders;
CREATE TRIGGER crave_order_guard BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION crave_guard_order_update();

-- One authoritative, idempotent capacity/stock restore (replaces the older
-- release_capacity_on_cancel / restore_capacity_on_cancel triggers).
CREATE OR REPLACE FUNCTION crave_restore_on_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item record;
BEGIN
    IF NEW.status::text IN ('CANCELLED', 'REJECTED', 'EXPIRED')
       AND OLD.status::text NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED') THEN
        IF NEW.pickup_slot_id IS NOT NULL THEN
            UPDATE pickup_slots SET
                booked_count = GREATEST(booked_count - 1, 0),
                status = CASE
                    WHEN GREATEST(booked_count - 1, 0) >= capacity THEN 'FULL'::pickup_slot_status
                    WHEN GREATEST(booked_count - 1, 0) >= capacity * 0.8 THEN 'LIMITED'::pickup_slot_status
                    ELSE 'AVAILABLE'::pickup_slot_status END
            WHERE id = NEW.pickup_slot_id;
        END IF;
        FOR v_item IN SELECT food_item_id, quantity FROM order_items WHERE order_id = NEW.id ORDER BY food_item_id LOOP
            UPDATE inventory SET quantity_available = quantity_available + v_item.quantity, updated_at = now()
            WHERE food_item_id = v_item.food_item_id;
        END LOOP;
        -- An unpaid online order that is cancelled can no longer be paid.
        UPDATE payments SET status = 'FAILED', updated_at = now()
        WHERE order_id = NEW.id AND status::text IN ('PENDING', 'CREATED', 'AUTHORIZED');
        UPDATE pickup_tokens SET is_used = true, used_at = COALESCE(used_at, now())
        WHERE order_id = NEW.id AND NOT is_used;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS release_capacity_on_cancel ON orders;
DROP TRIGGER IF EXISTS restore_capacity_on_cancel ON orders;
DROP TRIGGER IF EXISTS crave_restore_on_cancel ON orders;
CREATE TRIGGER crave_restore_on_cancel AFTER UPDATE OF status ON orders
    FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION crave_restore_on_cancel();

-- ---------------------------------------------------------------------------
-- 3. order_items / order_item_customizations / payments: read-only to clients
-- ---------------------------------------------------------------------------
SELECT crave_drop_all_policies('order_items');
CREATE POLICY order_items_select_own ON order_items FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.user_id = auth.uid()));
CREATE POLICY order_items_select_vendor ON order_items FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND crave_owns_outlet(o.outlet_id)));
CREATE POLICY order_items_select_admin ON order_items FOR SELECT TO authenticated USING (is_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON order_items FROM anon, authenticated;
REVOKE ALL ON order_items FROM anon;

SELECT crave_drop_all_policies('order_item_customizations');
CREATE POLICY oic_select_own ON order_item_customizations FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE oi.id = order_item_customizations.order_item_id AND o.user_id = auth.uid()));
CREATE POLICY oic_select_vendor ON order_item_customizations FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE oi.id = order_item_customizations.order_item_id AND crave_owns_outlet(o.outlet_id)));
CREATE POLICY oic_select_admin ON order_item_customizations FOR SELECT TO authenticated USING (is_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON order_item_customizations FROM anon, authenticated;
REVOKE ALL ON order_item_customizations FROM anon;

SELECT crave_drop_all_policies('payments');
CREATE POLICY payments_select_own ON payments FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = payments.order_id AND o.user_id = auth.uid()));
CREATE POLICY payments_select_vendor ON payments FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = payments.order_id AND crave_owns_outlet(o.outlet_id)));
CREATE POLICY payments_select_admin ON payments FOR SELECT TO authenticated USING (is_admin());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON payments FROM anon, authenticated;
REVOKE ALL ON payments FROM anon;

-- Razorpay event journal: webhook idempotency + audit trail (service role only).
CREATE TABLE IF NOT EXISTS payment_events (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_event_id  text UNIQUE NOT NULL,
    event_type         text NOT NULL,
    razorpay_order_id  text,
    razorpay_payment_id text,
    payload            jsonb,
    processed_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
SELECT crave_drop_all_policies('payment_events');
CREATE POLICY payment_events_select_admin ON payment_events FOR SELECT TO authenticated USING (is_admin());
REVOKE ALL ON payment_events FROM anon, authenticated;
GRANT SELECT ON payment_events TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. pickup_tokens: students read their own, vendors may only mark used
-- ---------------------------------------------------------------------------
SELECT crave_drop_all_policies('pickup_tokens');
CREATE POLICY tokens_select_own ON pickup_tokens FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = pickup_tokens.order_id AND o.user_id = auth.uid()));
CREATE POLICY tokens_select_vendor ON pickup_tokens FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = pickup_tokens.order_id AND crave_owns_outlet(o.outlet_id)));
CREATE POLICY tokens_select_admin ON pickup_tokens FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY tokens_update_vendor ON pickup_tokens FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM orders o WHERE o.id = pickup_tokens.order_id AND crave_owns_outlet(o.outlet_id)))
    WITH CHECK (true);
REVOKE INSERT, DELETE, TRUNCATE ON pickup_tokens FROM anon, authenticated;
REVOKE ALL ON pickup_tokens FROM anon;

CREATE OR REPLACE FUNCTION crave_guard_token_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF crave_is_internal() THEN RETURN NEW; END IF;
    IF NEW.token_value IS DISTINCT FROM OLD.token_value
       OR NEW.order_id IS DISTINCT FROM OLD.order_id
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR (OLD.is_used AND NOT NEW.is_used) THEN
        RAISE EXCEPTION 'Pickup tokens can only be marked as used.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crave_token_guard ON pickup_tokens;
CREATE TRIGGER crave_token_guard BEFORE UPDATE ON pickup_tokens
    FOR EACH ROW EXECUTE FUNCTION crave_guard_token_update();

-- ---------------------------------------------------------------------------
-- 5. Function grants (anon/authenticated are granted EXECUTE by default)
-- ---------------------------------------------------------------------------
SELECT crave_lock_function('mark_payment_verified(uuid,text,text,payment_status)', ARRAY['service_role']);
SELECT crave_lock_function('place_order(uuid,uuid,text)',                          ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('get_management_analytics()',                           ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('get_admin_stats()',                                    ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('admin_toggle_outlet_status(uuid,boolean)',             ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('verify_pickup_token(text)',                            ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('data_quality_report()',                                ARRAY['authenticated', 'service_role']);
-- Slot generation is a cron job (runs as the table owner); students must not be able to trigger it.
SELECT crave_lock_function('generate_pickup_slots()',                              ARRAY['service_role']);
-- Review RPCs return reviewer names / ids: signed-in users only (anon could call them before).
SELECT crave_lock_function('get_food_reviews(uuid,integer,integer)',               ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('get_review_for_order_item(uuid)',                      ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('get_vendor_reviews(integer,integer)',                  ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('get_management_reviews(integer,integer)',              ARRAY['authenticated', 'service_role']);

COMMIT;
