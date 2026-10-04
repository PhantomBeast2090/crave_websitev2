-- =============================================================================
-- Migration 017: Comprehensive Management Analytics
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_management_analytics() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_role TEXT;
    v_result JSONB;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

    -- Verify admin role from profiles table (not users!)
    SELECT role INTO v_role FROM profiles WHERE id = v_user_id;
    IF v_role != 'ADMIN' THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;

    -- Compute detailed analytics in a single JSON block
    SELECT jsonb_build_object(
        -- TIME-BASED METRICS (Asia/Kolkata)
        'ordersToday', (SELECT count(*) FROM orders WHERE (placed_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date),
        'revenueToday', COALESCE((
            SELECT sum(amount) FROM payments 
            WHERE status IN ('PAID', 'CAPTURED') 
            AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        ), 0),
        'ordersThisWeek', (SELECT count(*) FROM orders WHERE date_trunc('week', placed_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')),
        'revenueThisWeek', COALESCE((
            SELECT sum(amount) FROM payments 
            WHERE status IN ('PAID', 'CAPTURED') 
            AND date_trunc('week', created_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata')
        ), 0),
        'ordersThisMonth', (SELECT count(*) FROM orders WHERE date_trunc('month', placed_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')),
        'revenueThisMonth', COALESCE((
            SELECT sum(amount) FROM payments 
            WHERE status IN ('PAID', 'CAPTURED') 
            AND date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata') = date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')
        ), 0),

        -- ORDER METRICS
        'totalOrders', (SELECT count(*) FROM orders),
        'completedOrders', (SELECT count(*) FROM orders WHERE status = 'PICKED_UP'),
        'cancelledOrders', (SELECT count(*) FROM orders WHERE status = 'CANCELLED'),
        'rejectedOrders', (SELECT count(*) FROM orders WHERE status = 'REJECTED'),
        'activeOrders', (SELECT count(*) FROM orders WHERE status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')),

        -- PAYMENT METRICS
        'paidRevenue', COALESCE((SELECT sum(amount) FROM payments WHERE status IN ('PAID', 'CAPTURED')), 0),
        'refundedAmount', COALESCE((SELECT sum(amount) FROM payments WHERE status = 'REFUNDED'), 0),
        'cashRevenue', COALESCE((SELECT sum(amount) FROM payments WHERE status IN ('PAID', 'CAPTURED') AND gateway_provider = 'CASH'), 0),
        'razorpayRevenue', COALESCE((SELECT sum(amount) FROM payments WHERE status IN ('PAID', 'CAPTURED') AND gateway_provider = 'RAZORPAY'), 0),

        -- PLATFORM METRICS
        'totalStudents', (SELECT count(*) FROM profiles WHERE role = 'STUDENT'),
        'totalVendors', (SELECT count(*) FROM profiles WHERE role = 'VENDOR'),
        'totalOutlets', (SELECT count(*) FROM outlets),
        'activeOutlets', (SELECT count(*) FROM outlets WHERE is_open = true AND is_active = true),

        -- FOOD METRICS
        'totalFoodItems', (SELECT count(*) FROM food_items),
        'availableFoodItems', (SELECT count(*) FROM food_items WHERE is_available = true)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION get_management_analytics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_management_analytics() TO authenticated;

COMMIT;
