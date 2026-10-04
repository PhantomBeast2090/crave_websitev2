-- =============================================================================
-- Test 008: Auth Trigger Tests
-- =============================================================================

BEGIN;

-- We will simulate an insert into auth.users to see if a profile is created.
-- In a real Supabase environment, this is hard to mock perfectly without breaking existing constraints.
-- But we can try inserting a fake user if possible.
-- Since auth.users is managed by Supabase, direct inserts might fail if not careful.
-- However, we can test the function directly by inserting a temporary row.

DO $$
DECLARE
    new_user_id uuid := gen_random_uuid();
BEGIN
    -- 1. Insert fake auth user
    INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        raw_user_meta_data
    )
    VALUES (
        new_user_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'test_trigger_' || new_user_id || '@student.srmist.edu.in',
        'fake_password',
        '{"name": "Test Trigger", "phone": "9999999999", "registration_number": "RA2011000000000"}'::jsonb
    );

    -- 2. Check if profile was created
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = new_user_id) THEN
        RAISE EXCEPTION 'TEST FAILED: Profile was not created for new auth.users row.';
    END IF;

    -- 3. Check if profile fields matched
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = new_user_id 
          AND name = 'Test Trigger'
          AND phone = '9999999999'
          AND registration_number = 'RA2011000000000'
          AND role = 'STUDENT'
    ) THEN
        RAISE EXCEPTION 'TEST FAILED: Profile fields did not match raw_user_meta_data or default role.';
    END IF;

    RAISE NOTICE 'TEST PASSED: Trigger successfully created STUDENT profile from auth.users metadata.';
    
    -- Cleanup fake user (this will cascade delete the profile)
    DELETE FROM auth.users WHERE id = new_user_id;

END $$;

ROLLBACK;
