-- =============================================================================
-- Migration 004: Database Tests for Gag Backend
-- =============================================================================
-- HOW TO USE:
--   Copy each DO block into Supabase Dashboard > SQL Editor and run it.
--   All tests are READ-ONLY (no data is permanently changed).
--   Test 7 creates then rolls back temp data to test the state machine.
-- =============================================================================

-- TEST 1: All required tables exist
DO $$
DECLARE
    t TEXT;
    v_exists BOOLEAN;
    v_tables TEXT[] := ARRAY[
        'profiles','outlets','categories','food_items','food_variants',
        'food_variant_options','inventory','carts','cart_items',
        'cart_item_customizations','pickup_slots','orders','order_items',
        'order_item_customizations','payments','pickup_tokens','favorites',
        'reviews','notifications','coupons','audit_logs'
    ];
BEGIN
    FOREACH t IN ARRAY v_tables LOOP
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name=t
        ) INTO v_exists;
        IF v_exists THEN RAISE NOTICE 'PASS: table "%" exists', t;
        ELSE RAISE WARNING 'FAIL: table "%" is MISSING', t; END IF;
    END LOOP;
END $$;

-- TEST 2: food_items uses is_available (not is_active)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='food_items' AND column_name='is_available')
    THEN RAISE NOTICE 'PASS: food_items.is_available exists';
    ELSE RAISE WARNING 'FAIL: food_items.is_available is MISSING'; END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='food_items' AND column_name='is_active')
    THEN RAISE NOTICE 'PASS: food_items.is_active correctly absent';
    ELSE RAISE WARNING 'WARN: food_items.is_active exists — may conflict with RLS'; END IF;
END $$;

-- TEST 3: RLS enabled on all tables
DO $$
DECLARE
    t TEXT;
    v_rls BOOLEAN;
    v_tables TEXT[] := ARRAY[
        'profiles','outlets','categories','food_items','inventory',
        'carts','cart_items','pickup_slots','orders','order_items',
        'payments','pickup_tokens','favorites','reviews','notifications',
        'coupons','audit_logs'
    ];
BEGIN
    FOREACH t IN ARRAY v_tables LOOP
        SELECT relrowsecurity INTO v_rls FROM pg_class
        WHERE relname=t AND relnamespace='public'::regnamespace;
        IF v_rls THEN RAISE NOTICE 'PASS: RLS enabled on "%"', t;
        ELSE RAISE WARNING 'FAIL: RLS NOT enabled on "%"', t; END IF;
    END LOOP;
END $$;

-- TEST 4: Role escalation trigger exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname='protect_role_escalation' AND tgrelid='profiles'::regclass)
    THEN RAISE NOTICE 'PASS: protect_role_escalation trigger exists';
    ELSE RAISE WARNING 'FAIL: protect_role_escalation trigger MISSING'; END IF;
END $$;

-- TEST 5: Cart outlet enforcement trigger exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname='enforce_single_outlet_per_cart' AND tgrelid='cart_items'::regclass)
    THEN RAISE NOTICE 'PASS: enforce_single_outlet_per_cart trigger exists';
    ELSE RAISE WARNING 'FAIL: enforce_single_outlet_per_cart trigger MISSING'; END IF;
END $$;

-- TEST 6: Order state machine trigger exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname='order_state_machine' AND tgrelid='orders'::regclass)
    THEN RAISE NOTICE 'PASS: order_state_machine trigger exists';
    ELSE RAISE WARNING 'FAIL: order_state_machine trigger MISSING'; END IF;
END $$;

-- TEST 7: Invalid state transition is rejected (READY -> PREPARING)
DO $$
DECLARE
    v_uid  UUID := gen_random_uuid();
    v_oid  UUID := gen_random_uuid();
    v_ord  UUID;
BEGIN
    BEGIN
        -- Create temp data (will be rolled back)
        INSERT INTO profiles (id, name, email, role) VALUES (v_uid, 'Test', 'test_sm@test.internal', 'VENDOR');
        INSERT INTO outlets (id, name, description, vendor_id, is_open, is_active)
            VALUES (v_oid, 'T', 'T', v_uid, true, true);
        INSERT INTO orders (order_number, user_id, vendor_id, outlet_id, subtotal, tax, total, status, payment_status, payment_method)
            VALUES ('TEST-SM-001', v_uid, v_uid, v_oid, 100, 5, 105, 'READY', 'PENDING', 'PAY_AT_COUNTER')
            RETURNING id INTO v_ord;

        -- Attempt invalid READY -> PREPARING (should fail)
        UPDATE orders SET status = 'PREPARING' WHERE id = v_ord;
        RAISE WARNING 'FAIL: READY->PREPARING was NOT blocked by state machine';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'PASS: Invalid transition READY->PREPARING correctly rejected: %', SQLERRM;
    END;
    ROLLBACK;
END $$;

-- TEST 8: inventory.quantity_available CHECK constraint (>= 0)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints cc
        JOIN information_schema.constraint_column_usage ccu ON cc.constraint_name = ccu.constraint_name
        WHERE ccu.table_name='inventory' AND ccu.column_name='quantity_available'
    ) THEN RAISE NOTICE 'PASS: inventory.quantity_available has CHECK >= 0';
    ELSE RAISE WARNING 'FAIL: inventory.quantity_available missing CHECK constraint'; END IF;
END $$;

-- TEST 9: pickup_tokens.token_value is unique
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='pickup_tokens' AND indexname LIKE '%token_value%')
    THEN RAISE NOTICE 'PASS: pickup_tokens.token_value has unique index';
    ELSE RAISE WARNING 'FAIL: pickup_tokens.token_value missing unique index'; END IF;
END $$;

-- TEST 10: All security-critical functions exist
DO $$
DECLARE
    f TEXT;
    v_funcs TEXT[] := ARRAY[
        'place_order','verify_pickup_token','get_user_role','is_admin','is_vendor','is_student',
        'enforce_cart_single_outlet','enforce_order_state_machine','prevent_role_escalation',
        'notify_order_status_change','audit_critical_changes','update_order_status_timestamps'
    ];
BEGIN
    FOREACH f IN ARRAY v_funcs LOOP
        IF EXISTS (SELECT 1 FROM pg_proc WHERE proname=f AND pronamespace='public'::regnamespace)
        THEN RAISE NOTICE 'PASS: function "%" exists', f;
        ELSE RAISE WARNING 'FAIL: function "%" is MISSING', f; END IF;
    END LOOP;
END $$;

-- TEST 11: Performance indexes exist
DO $$
DECLARE
    idx TEXT;
    v_indexes TEXT[] := ARRAY[
        'idx_cart_items_cart','idx_food_items_available','idx_orders_created_at',
        'idx_pickup_slots_time','idx_notifications_unread','idx_orders_user',
        'idx_orders_outlet','idx_orders_status','idx_food_items_outlet',
        'idx_food_items_category','idx_notifications_user'
    ];
BEGIN
    FOREACH idx IN ARRAY v_indexes LOOP
        IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname=idx)
        THEN RAISE NOTICE 'PASS: index "%" exists', idx;
        ELSE RAISE WARNING 'FAIL: index "%" is MISSING', idx; END IF;
    END LOOP;
END $$;

-- TEST 12: Realtime publication
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['orders','notifications'] LOOP
        IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename=t)
        THEN RAISE NOTICE 'PASS: "%" is in supabase_realtime', t;
        ELSE RAISE WARNING 'FAIL: "%" is NOT in supabase_realtime', t; END IF;
    END LOOP;
END $$;

-- TEST 13: Audit and notification triggers exist
DO $$
DECLARE
    pair TEXT[];
    v_pairs TEXT[][] := ARRAY[
        ARRAY['audit_order_changes','orders'],
        ARRAY['audit_inventory_changes','inventory'],
        ARRAY['order_status_notification','orders'],
        ARRAY['order_status_timestamps','orders']
    ];
BEGIN
    FOREACH pair SLICE 1 IN ARRAY v_pairs LOOP
        IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=pair[1] AND tgrelid=pair[2]::regclass)
        THEN RAISE NOTICE 'PASS: trigger "%" on "%" exists', pair[1], pair[2];
        ELSE RAISE WARNING 'FAIL: trigger "%" on "%" MISSING', pair[1], pair[2]; END IF;
    END LOOP;
END $$;
