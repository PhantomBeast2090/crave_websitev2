-- ============================================================================
-- 021_dashboards_and_admin.sql
--
--  * get_management_dashboard(): campus-wide analytics in Asia/Kolkata. Revenue
--    counts ONLY payments in PAID/CAPTURED (never created/authorized/failed/
--    refunded) and is bucketed by when the money was received.
--  * get_vendor_dashboard(): the same, scoped to the caller's own outlets.
--  * admin_set_user_role / admin_set_user_active: audited management actions.
--  * Guards so a vendor cannot inflate its own ratings or hand its outlet away.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_management_dashboard(p_days integer DEFAULT 14) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_days   integer := LEAST(GREATEST(COALESCE(p_days, 14), 1), 90);
    v_today  date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    v_result jsonb;
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;

    WITH paid AS (
        SELECT p.amount, p.gateway_provider::text AS provider,
               (COALESCE(p.paid_at, p.updated_at) AT TIME ZONE 'Asia/Kolkata')::date AS d
        FROM payments p WHERE p.status::text IN ('PAID', 'CAPTURED')
    ), ord AS (
        SELECT o.status::text AS status, (COALESCE(o.placed_at, o.created_at) AT TIME ZONE 'Asia/Kolkata')::date AS d
        FROM orders o
    )
    SELECT jsonb_build_object(
        'generatedAt', now(),
        'ordersToday',      (SELECT count(*) FROM ord WHERE d = v_today),
        'ordersThisWeek',   (SELECT count(*) FROM ord WHERE d >= date_trunc('week', v_today)::date),
        'ordersThisMonth',  (SELECT count(*) FROM ord WHERE d >= date_trunc('month', v_today)::date),
        'revenueToday',     COALESCE((SELECT sum(amount) FROM paid WHERE d = v_today), 0),
        'revenueThisWeek',  COALESCE((SELECT sum(amount) FROM paid WHERE d >= date_trunc('week', v_today)::date), 0),
        'revenueThisMonth', COALESCE((SELECT sum(amount) FROM paid WHERE d >= date_trunc('month', v_today)::date), 0),
        'totalOrders',      (SELECT count(*) FROM ord),
        'completedOrders',  (SELECT count(*) FROM ord WHERE status = 'PICKED_UP'),
        'activeOrders',     (SELECT count(*) FROM ord WHERE status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')),
        'cancelledOrders',  (SELECT count(*) FROM ord WHERE status IN ('CANCELLED', 'EXPIRED')),
        'rejectedOrders',   (SELECT count(*) FROM ord WHERE status = 'REJECTED'),
        'paidRevenue',      COALESCE((SELECT sum(amount) FROM paid), 0),
        'razorpayRevenue',  COALESCE((SELECT sum(amount) FROM paid WHERE provider = 'RAZORPAY'), 0),
        'cashRevenue',      COALESCE((SELECT sum(amount) FROM paid WHERE provider = 'CASH'), 0),
        'refundedAmount',   COALESCE((SELECT sum(amount) FROM payments WHERE status::text = 'REFUNDED'), 0),
        'failedPayments',   (SELECT count(*) FROM payments WHERE status::text = 'FAILED'),
        'pendingPayments',  (SELECT count(*) FROM payments p JOIN orders o ON o.id = p.order_id
                              WHERE p.status::text IN ('PENDING', 'CREATED', 'AUTHORIZED') AND o.status::text IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')),
        'refundRequiredCount',  (SELECT count(*) FROM payments p JOIN orders o ON o.id = p.order_id
                                  WHERE p.status::text IN ('PAID', 'CAPTURED') AND o.status::text IN ('CANCELLED', 'REJECTED', 'EXPIRED')),
        'refundRequiredAmount', COALESCE((SELECT sum(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id
                                  WHERE p.status::text IN ('PAID', 'CAPTURED') AND o.status::text IN ('CANCELLED', 'REJECTED', 'EXPIRED')), 0),
        'totalStudents',    (SELECT count(*) FROM profiles WHERE role::text = 'STUDENT'),
        'totalVendors',     (SELECT count(*) FROM profiles WHERE role::text = 'VENDOR'),
        'pendingVendors',   (SELECT count(*) FROM profiles WHERE role::text = 'PENDING_VENDOR'),
        'totalOutlets',     (SELECT count(*) FROM outlets WHERE deleted_at IS NULL),
        'activeOutlets',    (SELECT count(*) FROM outlets WHERE deleted_at IS NULL AND is_open AND is_active),
        'totalFoodItems',   (SELECT count(*) FROM food_items WHERE deleted_at IS NULL),
        'availableFoodItems', (SELECT count(*) FROM food_items WHERE deleted_at IS NULL AND is_available),
        'trend', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'date', g.d,
                    'orders',  (SELECT count(*) FROM ord WHERE ord.d = g.d),
                    'revenue', COALESCE((SELECT sum(amount) FROM paid WHERE paid.d = g.d), 0)) ORDER BY g.d), '[]'::jsonb)
                  FROM generate_series(v_today - (v_days - 1), v_today, interval '1 day') AS gs(ts)
                  CROSS JOIN LATERAL (SELECT gs.ts::date AS d) g),
        'topOutlets', (SELECT COALESCE(jsonb_agg(t), '[]'::jsonb) FROM (
                    SELECT o.id AS outlet_id, ou.name, count(*) AS orders, COALESCE(sum(p.amount), 0) AS revenue
                    FROM orders o JOIN outlets ou ON ou.id = o.outlet_id
                    LEFT JOIN payments p ON p.order_id = o.id AND p.status::text IN ('PAID', 'CAPTURED')
                    WHERE o.created_at >= now() - interval '30 days' AND o.status::text NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED')
                    GROUP BY o.id, ou.name ORDER BY revenue DESC, orders DESC LIMIT 5) t)
    ) INTO v_result;
    RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION get_vendor_dashboard(p_outlet_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid   uuid := auth.uid();
    v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
    v_result jsonb;
BEGIN
    IF get_user_role() IS DISTINCT FROM 'VENDOR' THEN RAISE EXCEPTION 'Only vendors can call this function.'; END IF;
    IF p_outlet_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM outlets WHERE id = p_outlet_id AND vendor_id = v_uid) THEN
        RAISE EXCEPTION 'Outlet not found.';
    END IF;

    WITH my_outlets AS (
        SELECT id, name, rating, total_reviews, is_open, is_active FROM outlets
        WHERE vendor_id = v_uid AND deleted_at IS NULL AND (p_outlet_id IS NULL OR id = p_outlet_id)
    ), ord AS (
        SELECT o.id, o.outlet_id, o.status::text AS status, o.total,
               (COALESCE(o.placed_at, o.created_at) AT TIME ZONE 'Asia/Kolkata')::date AS d,
               (o.payment_method::text = 'PAY_AT_COUNTER' OR o.payment_status::text IN ('PAID', 'CAPTURED', 'REFUNDED')
                OR o.status::text IN ('REJECTED', 'CANCELLED', 'EXPIRED')) AS visible,
               o.payment_status::text IN ('PAID', 'CAPTURED') AS paid
        FROM orders o WHERE o.outlet_id IN (SELECT id FROM my_outlets)
    ), vis AS (SELECT * FROM ord WHERE visible)
    SELECT jsonb_build_object(
        'ordersToday',     (SELECT count(*) FROM vis WHERE d = v_today AND status NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED')),
        'revenueToday',    COALESCE((SELECT sum(total) FROM vis WHERE d = v_today AND paid), 0),
        'newOrders',       (SELECT count(*) FROM vis WHERE status = 'PLACED'),
        'activeOrders',    (SELECT count(*) FROM vis WHERE status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')),
        'completedToday',  (SELECT count(*) FROM vis WHERE d = v_today AND status = 'PICKED_UP'),
        'outlets', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', m.id, 'name', m.name, 'rating', m.rating, 'totalReviews', m.total_reviews,
                        'isOpen', m.is_open, 'isActive', m.is_active,
                        'ordersToday', (SELECT count(*) FROM vis WHERE outlet_id = m.id AND d = v_today AND status NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED')),
                        'activeOrders', (SELECT count(*) FROM vis WHERE outlet_id = m.id AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY'))
                    ) ORDER BY m.name), '[]'::jsonb) FROM my_outlets m),
        'trend', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'date', g.d,
                    'orders',  (SELECT count(*) FROM vis WHERE vis.d = g.d AND status NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED')),
                    'revenue', COALESCE((SELECT sum(total) FROM vis WHERE vis.d = g.d AND paid), 0)) ORDER BY g.d), '[]'::jsonb)
                  FROM generate_series(v_today - 6, v_today, interval '1 day') AS gs(ts)
                  CROSS JOIN LATERAL (SELECT gs.ts::date AS d) g)
    ) INTO v_result;
    RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION admin_set_user_role(p_user_id uuid, p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text;
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;
    IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Administrators cannot change their own role.'; END IF;
    IF p_role NOT IN ('STUDENT', 'VENDOR', 'PENDING_VENDOR', 'ADMIN') THEN RAISE EXCEPTION 'Unknown role.'; END IF;
    SELECT role::text INTO v_old FROM profiles WHERE id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found.'; END IF;
    UPDATE profiles SET role = p_role::user_role, updated_at = now() WHERE id = p_user_id;
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'USER_ROLE_CHANGED', 'profiles', p_user_id, jsonb_build_object('role', v_old), jsonb_build_object('role', p_role));
END $$;

CREATE OR REPLACE FUNCTION admin_set_user_active(p_user_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;
    IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'Administrators cannot disable their own account.'; END IF;
    UPDATE profiles SET is_active = p_active, updated_at = now() WHERE id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'User not found.'; END IF;
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (auth.uid(), 'USER_ACTIVE_CHANGED', 'profiles', p_user_id, jsonb_build_object('is_active', p_active));
END $$;

-- Management: orders whose captured payment must be returned to the student.
CREATE OR REPLACE FUNCTION admin_refund_candidates() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;
    RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'order_number', o.order_number, 'amount', p.amount, 'order_status', o.status,
        'student_name', pr.name, 'razorpay_payment_id', p.razorpay_payment_id, 'paid_at', COALESCE(p.paid_at, p.updated_at))
        ORDER BY COALESCE(p.paid_at, p.updated_at) DESC), '[]'::jsonb)
      FROM payments p JOIN orders o ON o.id = p.order_id JOIN profiles pr ON pr.id = o.user_id
     WHERE p.status::text IN ('PAID', 'CAPTURED') AND o.status::text IN ('CANCELLED', 'REJECTED', 'EXPIRED')
       AND p.gateway_provider::text = 'RAZORPAY');
END $$;

-- ---------------------------------------------------------------------------
-- Vendors may run their outlet, but not forge ratings or transfer ownership.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crave_guard_outlet_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF crave_is_internal() OR is_admin() THEN RETURN NEW; END IF;
    IF NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.rating IS DISTINCT FROM OLD.rating
       OR NEW.total_reviews IS DISTINCT FROM OLD.total_reviews THEN
        RAISE EXCEPTION 'Outlet ownership and ratings are managed by Crave.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crave_outlet_guard ON outlets;
CREATE TRIGGER crave_outlet_guard BEFORE UPDATE ON outlets FOR EACH ROW EXECUTE FUNCTION crave_guard_outlet_update();

CREATE OR REPLACE FUNCTION crave_guard_food_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF crave_is_internal() OR is_admin() THEN RETURN NEW; END IF;
    IF NEW.rating IS DISTINCT FROM OLD.rating OR NEW.total_reviews IS DISTINCT FROM OLD.total_reviews THEN
        RAISE EXCEPTION 'Food ratings are computed from reviews.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crave_food_guard ON food_items;
CREATE TRIGGER crave_food_guard BEFORE UPDATE ON food_items FOR EACH ROW EXECUTE FUNCTION crave_guard_food_update();

-- search_food leaked other vendors' unavailable / inactive-outlet items to any
-- vendor ("privileged" meant every vendor). Scope vendors to their own outlets.
CREATE OR REPLACE FUNCTION search_food(
    p_query TEXT DEFAULT '', p_outlet_id UUID DEFAULT NULL, p_category TEXT DEFAULT NULL,
    p_is_veg BOOLEAN DEFAULT NULL, p_max_price DECIMAL DEFAULT NULL, p_available_only BOOLEAN DEFAULT true
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_results JSONB;
    v_admin   BOOLEAN := is_admin();
    v_q       TEXT := COALESCE(p_query, '');
BEGIN
    SELECT COALESCE(jsonb_agg(s.obj ORDER BY s.rn), '[]'::jsonb) INTO v_results FROM (
        SELECT row_number() OVER (ORDER BY CASE WHEN fi.name ILIKE v_q THEN 0 ELSE 1 END, fi.is_popular DESC, fi.rating DESC, fi.name ASC) AS rn,
               jsonb_build_object(
                'id', fi.id, 'name', fi.name, 'description', fi.description, 'image_url', fi.image_url,
                'price', fi.price, 'is_veg', fi.is_veg, 'is_available', fi.is_available,
                'prep_time_minutes', fi.prep_time_minutes, 'is_popular', fi.is_popular, 'is_recommended', fi.is_recommended,
                'rating', fi.rating, 'outlet_id', fi.outlet_id, 'outlet_name', ou.name,
                'category_id', fi.category_id, 'category_name', cat.name) AS obj
        FROM food_items fi
        JOIN outlets ou ON ou.id = fi.outlet_id
        JOIN categories cat ON cat.id = fi.category_id
        WHERE fi.deleted_at IS NULL AND ou.deleted_at IS NULL
          AND (v_admin
               OR (ou.vendor_id = auth.uid() AND is_vendor() AND (NOT p_available_only OR fi.is_available))
               OR (fi.is_available AND ou.is_active))
          AND (v_q = '' OR fi.name ILIKE '%' || v_q || '%' OR fi.description ILIKE '%' || v_q || '%'
               OR EXISTS (SELECT 1 FROM unnest(fi.tags) t WHERE t ILIKE '%' || v_q || '%'))
          AND (p_outlet_id IS NULL OR fi.outlet_id = p_outlet_id)
          AND (p_category IS NULL OR cat.name ILIKE p_category)
          AND (p_is_veg IS NULL OR fi.is_veg = p_is_veg)
          AND (p_max_price IS NULL OR fi.price <= p_max_price)
        ORDER BY rn
        LIMIT 100) s;
    RETURN v_results;
END $$;

SELECT crave_lock_function('get_management_dashboard(integer)',  ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('get_vendor_dashboard(uuid)',         ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('admin_set_user_role(uuid,text)',     ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('admin_set_user_active(uuid,boolean)', ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('admin_refund_candidates()',          ARRAY['authenticated', 'service_role']);

COMMIT;
