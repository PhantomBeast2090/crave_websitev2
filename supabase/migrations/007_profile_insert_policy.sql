-- =============================================================================
-- Migration 007: Secure profile self-INSERT policy
-- =============================================================================
-- No trigger is used. Profiles are created by the Android client on first login
-- AFTER email verification succeeds (so auth.uid() is always valid).
--
-- Security guarantees enforced by this policy:
--   1. id MUST equal auth.uid()  (cannot create profiles for other users)
--   2. role MUST be 'STUDENT'    (cannot self-promote to VENDOR or ADMIN)
--   3. is_active defaults to true (schema default, not client-controlled)
--
-- Admins retain full access via the existing "Admins have full access to profiles" policy.
-- =============================================================================

-- Drop the trigger we added in migration 006 (if it was applied), since we are
-- moving to the client-side upsert approach instead.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Self-service INSERT: authenticated user can only create their OWN profile as STUDENT
CREATE POLICY "Users can create their own student profile"
ON profiles
FOR INSERT
WITH CHECK (
    auth.uid() = id
    AND role = 'STUDENT'
);
