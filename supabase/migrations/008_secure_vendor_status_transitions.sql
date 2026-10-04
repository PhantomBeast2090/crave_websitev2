-- =============================================================================
-- Migration 008: Secure Vendor Status Transitions
-- =============================================================================

BEGIN;

-- 1. vendor_accept_order (PLACED -> ACCEPTED)
CREATE OR REPLACE FUNCTION vendor_accept_order(p_order_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_vendor_id UUID := auth.uid();
    v_order RECORD;
BEGIN
    IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

    -- Fetch order and lock for update to prevent race conditions
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;

    -- Verify vendor authorization
    IF v_order.vendor_id != v_vendor_id THEN 
        RAISE EXCEPTION 'Unauthorized: Vendor does not own this order.'; 
    END IF;

    -- Verify state transition
    IF v_order.status != 'PLACED' THEN
        RAISE EXCEPTION 'Invalid transition: Cannot accept order from status %', v_order.status;
    END IF;

    -- Perform atomic update
    UPDATE orders SET status = 'ACCEPTED' WHERE id = p_order_id;
END;
$$;

-- 2. vendor_reject_order (PLACED -> REJECTED)
CREATE OR REPLACE FUNCTION vendor_reject_order(p_order_id UUID, p_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_vendor_id UUID := auth.uid();
    v_order RECORD;
BEGIN
    IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

    -- Fetch order and lock for update to prevent race conditions
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;

    -- Verify vendor authorization
    IF v_order.vendor_id != v_vendor_id THEN 
        RAISE EXCEPTION 'Unauthorized: Vendor does not own this order.'; 
    END IF;

    -- Verify state transition
    IF v_order.status != 'PLACED' THEN
        RAISE EXCEPTION 'Invalid transition: Cannot reject order from status %', v_order.status;
    END IF;

    -- Perform atomic update
    UPDATE orders SET status = 'REJECTED', cancellation_reason = p_reason WHERE id = p_order_id;
END;
$$;

-- 3. vendor_start_preparing (ACCEPTED -> PREPARING)
CREATE OR REPLACE FUNCTION vendor_start_preparing(p_order_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_vendor_id UUID := auth.uid();
    v_order RECORD;
BEGIN
    IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

    -- Fetch order and lock for update to prevent race conditions
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;

    -- Verify vendor authorization
    IF v_order.vendor_id != v_vendor_id THEN 
        RAISE EXCEPTION 'Unauthorized: Vendor does not own this order.'; 
    END IF;

    -- Verify state transition
    IF v_order.status != 'ACCEPTED' THEN
        RAISE EXCEPTION 'Invalid transition: Cannot start preparing from status %', v_order.status;
    END IF;

    -- Perform atomic update
    UPDATE orders SET status = 'PREPARING' WHERE id = p_order_id;
END;
$$;

-- 4. vendor_mark_ready (PREPARING -> READY)
CREATE OR REPLACE FUNCTION vendor_mark_ready(p_order_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_vendor_id UUID := auth.uid();
    v_order RECORD;
BEGIN
    IF v_vendor_id IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;

    -- Fetch order and lock for update to prevent race conditions
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;

    -- Verify vendor authorization
    IF v_order.vendor_id != v_vendor_id THEN 
        RAISE EXCEPTION 'Unauthorized: Vendor does not own this order.'; 
    END IF;

    -- Verify state transition
    IF v_order.status != 'PREPARING' THEN
        RAISE EXCEPTION 'Invalid transition: Cannot mark ready from status %', v_order.status;
    END IF;

    -- Perform atomic update
    UPDATE orders SET status = 'READY' WHERE id = p_order_id;
END;
$$;

-- 5. Permissions
REVOKE ALL ON FUNCTION vendor_accept_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vendor_accept_order(UUID) TO authenticated;

REVOKE ALL ON FUNCTION vendor_reject_order(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vendor_reject_order(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION vendor_start_preparing(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vendor_start_preparing(UUID) TO authenticated;

REVOKE ALL ON FUNCTION vendor_mark_ready(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vendor_mark_ready(UUID) TO authenticated;

COMMIT;
