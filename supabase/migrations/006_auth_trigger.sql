-- =============================================================================
-- Migration 006: Secure Profile Creation Trigger
-- =============================================================================

BEGIN;

-- 1. Create the trigger function with SECURITY DEFINER
-- This ensures the function runs with elevated privileges, bypassing RLS
-- to insert the profile when auth.users is created.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO public.profiles (
        id,
        name,
        email,
        phone,
        role,
        registration_number,
        is_active,
        created_at
    )
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
        new.email,
        new.raw_user_meta_data->>'phone',
        'STUDENT', -- Hardcode to STUDENT for self-registration via Android
        new.raw_user_meta_data->>'registration_number',
        true,
        NOW()
    );
    RETURN new;
END;
$$;

-- 2. Create the trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

COMMIT;
