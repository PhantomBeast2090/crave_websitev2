-- =============================================================================
-- Migration 010: Payment Gateway Support (Razorpay)
-- =============================================================================

BEGIN;

-- 1. EXTEND PAYMENT STATUS ENUM
-- Note: Postgres doesn't allow ALTER TYPE ... ADD VALUE inside a transaction block easily
-- if used in tables. But Supabase migrations usually run them.
-- Existing: PENDING, PAID, FAILED, REFUNDED.
-- Razorpay: CREATED, AUTHORIZED, CAPTURED, FAILED, REFUNDED.
-- We can map PENDING -> CREATED/AUTHORIZED and PAID -> CAPTURED for simplicity,
-- or add specific values. Let's add them for better tracking.

ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'CREATED';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'AUTHORIZED';
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'CAPTURED';

-- 2. CREATE PROVIDER ENUM
CREATE TYPE payment_provider AS ENUM ('RAZORPAY', 'CASH');

-- 3. UPDATE PAYMENTS TABLE
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_provider payment_provider NOT NULL DEFAULT 'CASH';
ALTER TABLE payments RENAME COLUMN gateway_order_id TO razorpay_order_id;
ALTER TABLE payments RENAME COLUMN gateway_payment_id TO razorpay_payment_id;
ALTER TABLE payments RENAME COLUMN gateway_signature TO razorpay_signature;

-- 4. HARDEN ORDER RLS FOR VENDORS
-- Vendors should only see ONLINE orders if they are PAID/CAPTURED.
-- This prevents them from starting preparation for an order that might fail payment.

DROP POLICY IF EXISTS "Vendors manage their outlet's orders" ON orders;

CREATE POLICY "Vendors manage their outlet's orders" ON orders FOR ALL USING (
    (auth.uid() = vendor_id)
    AND (
        payment_method = 'PAY_AT_COUNTER'
        OR payment_status IN ('PAID', 'REFUNDED')
        OR status IN ('REJECTED', 'CANCELLED') -- Allow seeing rejected/cancelled even if unpaid
    )
);

-- 5. ATOMIC VERIFICATION HELPER (Idempotent)
CREATE OR REPLACE FUNCTION mark_payment_verified(
    p_order_id UUID,
    p_razorpay_payment_id TEXT,
    p_razorpay_signature TEXT,
    p_status payment_status DEFAULT 'PAID'
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    WHERE id = p_order_id;
END;
$$;

COMMIT;
