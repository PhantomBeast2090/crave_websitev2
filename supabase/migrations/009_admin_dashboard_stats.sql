-- =============================================================================
-- Migration 009: Admin Dashboard Integration
-- =============================================================================

BEGIN;

-- 1. get_admin_stats
CREATE OR REPLACE FUNCTION get_admin_stats() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_role TEXT;
    v_result JSONB;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

    -- Verify admin role
    SELECT role INTO v_role FROM users WHERE id = v_user_id;
    IF v_role != 'ADMIN' THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;

    -- Compute stats
    SELECT jsonb_build_object(
        'totalUsers', (SELECT count(*) FROM users WHERE role = 'STUDENT'),
        'totalVendors', (SELECT count(*) FROM users WHERE role = 'VENDOR'),
        'totalOutlets', (SELECT count(*) FROM outlets),
        'totalOrders', (SELECT count(*) FROM orders),
        'activeOrders', (SELECT count(*) FROM orders WHERE status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY')),
        'completedOrders', (SELECT count(*) FROM orders WHERE status = 'PICKED_UP'),
        'revenue', COALESCE((SELECT sum(total) FROM orders WHERE status = 'PICKED_UP'), 0),
        'ordersToday', (SELECT count(*) FROM orders WHERE DATE(placed_at) = CURRENT_DATE),
        'revenueToday', COALESCE((SELECT sum(total) FROM orders WHERE status = 'PICKED_UP' AND DATE(placed_at) = CURRENT_DATE), 0)
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- 2. admin_toggle_outlet_status
CREATE OR REPLACE FUNCTION admin_toggle_outlet_status(p_outlet_id UUID, p_is_open BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_role TEXT;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

    -- Verify admin role
    SELECT role INTO v_role FROM users WHERE id = v_user_id;
    IF v_role != 'ADMIN' THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;

    -- Perform atomic update
    UPDATE outlets SET is_open = p_is_open WHERE id = p_outlet_id;
END;
$$;

-- 3. Permissions
REVOKE ALL ON FUNCTION get_admin_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_admin_stats() TO authenticated;

REVOKE ALL ON FUNCTION admin_toggle_outlet_status(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_toggle_outlet_status(UUID, BOOLEAN) TO authenticated;

COMMIT;
