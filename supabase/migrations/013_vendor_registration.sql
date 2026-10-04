-- =============================================================================
-- Migration 013: Vendor Registration & Pending Approval Flow
-- =============================================================================
-- Applied in two steps due to PostgreSQL constraint that new enum values must
-- be committed before they can be used inside policies.
--
-- STEP 1 (committed separately): Add PENDING_VENDOR enum value
-- STEP 2 (this transaction):     Update profile self-INSERT policy
--
-- Security guarantees:
--   1. id MUST equal auth.uid()                (cannot create profiles for others)
--   2. role MUST be 'STUDENT' or 'PENDING_VENDOR' (cannot self-grant VENDOR/ADMIN)
--   3. PENDING_VENDOR users have no access to vendor-side DB operations:
--      - verify_pickup_token() guards via get_user_role() = 'VENDOR'
--      - All vendor RLS policies use is_vendor() which checks role = 'VENDOR'
--      - Only an ADMIN can UPDATE profiles.role from PENDING_VENDOR -> VENDOR
--        (the protect_role_escalation trigger in migration 003 enforces this)
-- =============================================================================

-- STEP 1: Add PENDING_VENDOR enum value (must be outside a transaction block)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumtypid = 'user_role'::regtype
          AND enumlabel = 'PENDING_VENDOR'
    ) THEN
        ALTER TYPE user_role ADD VALUE 'PENDING_VENDOR';
    END IF;
END $$;

-- STEP 2: Replace the self-INSERT policy from migration 007
-- (Run this after the enum value above has been committed)
DROP POLICY IF EXISTS "Users can create their own student profile" ON profiles;
DROP POLICY IF EXISTS "Users can create their own profile" ON profiles;

CREATE POLICY "Users can create their own profile"
ON profiles
FOR INSERT
WITH CHECK (
    auth.uid() = id
    AND role IN ('STUDENT', 'PENDING_VENDOR')
);

-- No other changes required:
-- - prevent_role_escalation trigger (migration 003) already blocks
--   any self-update of role field for non-admins.
-- - is_vendor() returns false for PENDING_VENDOR (role != 'VENDOR').
-- - All vendor-side RLS and RPCs remain strictly scoped to role = 'VENDOR'.
