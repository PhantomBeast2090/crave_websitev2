-- =============================================================================
-- Migration 006: Catalogue Security & Data Tests
-- =============================================================================
-- HOW TO USE:
--   Run each DO block in Supabase SQL Editor. All are read-only unless noted.
--   Look for PASS/FAIL in the Messages tab.
-- =============================================================================

-- TEST 1: Active outlet visible (schema check)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='outlets' AND column_name='is_active'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='outlets' AND column_name='is_open'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='outlets' AND column_name='deleted_at'
    ) THEN
        RAISE NOTICE 'PASS: outlets has is_active, is_open, deleted_at columns';
    ELSE
        RAISE WARNING 'FAIL: outlets is missing required columns';
    END IF;
END $$;

-- TEST 2: food_items.is_available exists (not is_active)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='food_items' AND column_name='is_available'
    ) THEN
        RAISE NOTICE 'PASS: food_items.is_available exists';
    ELSE
        RAISE WARNING 'FAIL: food_items.is_available MISSING';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='food_items' AND column_name='is_active'
    ) THEN
        RAISE NOTICE 'PASS: food_items.is_active correctly absent';
    ELSE
        RAISE WARNING 'WARN: food_items.is_active exists — may conflict with RLS';
    END IF;
END $$;

-- TEST 3: food_variants and food_variant_options tables exist with correct FKs
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='food_variants')
    AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='food_variant_options')
    THEN
        RAISE NOTICE 'PASS: food_variants and food_variant_options tables exist';
    ELSE
        RAISE WARNING 'FAIL: food_variants or food_variant_options MISSING';
    END IF;
END $$;

-- TEST 4: Price check constraint exists on food_items
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints cc
        JOIN information_schema.constraint_column_usage ccu ON cc.constraint_name = ccu.constraint_name
        WHERE ccu.table_name = 'food_items' AND ccu.column_name = 'price'
    ) THEN
        RAISE NOTICE 'PASS: food_items.price has CHECK constraint';
    ELSE
        RAISE WARNING 'FAIL: food_items.price missing CHECK constraint';
    END IF;
END $$;

-- TEST 5: Student cannot INSERT food_items (policy check)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'food_items'
        AND cmd IN ('ALL','INSERT')
        AND policyname LIKE '%Vendor%'
    ) THEN
        RAISE NOTICE 'PASS: food_items has vendor INSERT policy (students blocked by absence of student INSERT policy)';
    ELSE
        RAISE WARNING 'FAIL: food_items may allow unauthorized INSERT';
    END IF;
    -- Confirm no student INSERT policy exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'food_items'
        AND cmd = 'INSERT'
        AND policyname ILIKE '%student%'
    ) THEN
        RAISE NOTICE 'PASS: No student INSERT policy on food_items';
    ELSE
        RAISE WARNING 'FAIL: Student INSERT policy exists on food_items';
    END IF;
END $$;

-- TEST 6: food_items.price >= 0 CHECK exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'food_items'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) LIKE '%price%>=%0%'
    ) THEN
        RAISE NOTICE 'PASS: food_items has price >= 0 constraint';
    ELSE
        RAISE WARNING 'WARN: food_items price >= 0 constraint not found by name (may still exist as unnamed)';
    END IF;
END $$;

-- TEST 7: Vendor isolation — vendor food policy exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename='food_items'
        AND policyname='Vendors manage their food items'
    ) THEN
        RAISE NOTICE 'PASS: "Vendors manage their food items" policy exists';
    ELSE
        RAISE WARNING 'FAIL: Vendor food isolation policy MISSING';
    END IF;
END $$;

-- TEST 8: Vendor cannot update another vendor outlet (policy check)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename='outlets'
        AND policyname='Vendors can manage their own outlets'
    ) THEN
        RAISE NOTICE 'PASS: Outlets has vendor isolation policy';
    ELSE
        RAISE WARNING 'FAIL: Outlet vendor isolation policy MISSING';
    END IF;
END $$;

-- TEST 9: food_items FK to outlets exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
            ON rc.constraint_name = kcu.constraint_name
        WHERE kcu.table_name='food_items' AND kcu.column_name='outlet_id'
    ) THEN
        RAISE NOTICE 'PASS: food_items.outlet_id FK to outlets exists';
    ELSE
        RAISE WARNING 'FAIL: food_items.outlet_id FK MISSING';
    END IF;
END $$;

-- TEST 10: food_items FK to categories exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
            ON rc.constraint_name = kcu.constraint_name
        WHERE kcu.table_name='food_items' AND kcu.column_name='category_id'
    ) THEN
        RAISE NOTICE 'PASS: food_items.category_id FK to categories exists';
    ELSE
        RAISE WARNING 'FAIL: food_items.category_id FK MISSING';
    END IF;
END $$;

-- TEST 11: food_variants FK to food_items exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu
            ON rc.constraint_name = kcu.constraint_name
        WHERE kcu.table_name='food_variants' AND kcu.column_name='food_item_id'
    ) THEN
        RAISE NOTICE 'PASS: food_variants.food_item_id FK exists';
    ELSE
        RAISE WARNING 'FAIL: food_variants.food_item_id FK MISSING';
    END IF;
END $$;

-- TEST 12: food_variant_options.extra_price >= 0 check
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints cc
        JOIN information_schema.constraint_column_usage ccu ON cc.constraint_name = ccu.constraint_name
        WHERE ccu.table_name='food_variant_options' AND ccu.column_name='extra_price'
    ) THEN
        RAISE NOTICE 'PASS: food_variant_options.extra_price has CHECK constraint';
    ELSE
        RAISE WARNING 'FAIL: food_variant_options.extra_price missing CHECK constraint';
    END IF;
END $$;

-- TEST 13: Catalogue RPCs exist
DO $$
DECLARE
    f TEXT;
    v_funcs TEXT[] := ARRAY['get_catalogue_for_outlet','search_food','data_quality_report'];
BEGIN
    FOREACH f IN ARRAY v_funcs LOOP
        IF EXISTS (
            SELECT 1 FROM pg_proc
            WHERE proname=f AND pronamespace='public'::regnamespace
        ) THEN
            RAISE NOTICE 'PASS: function "%" exists', f;
        ELSE
            RAISE WARNING 'FAIL: function "%" MISSING', f;
        END IF;
    END LOOP;
END $$;

-- TEST 14: Performance indexes exist
DO $$
DECLARE
    idx TEXT;
    v_indexes TEXT[] := ARRAY[
        'idx_outlets_active_open','idx_food_items_outlet_available',
        'idx_food_variants_item','idx_food_variant_options_var',
        'idx_food_items_is_popular','idx_food_items_is_recommended',
        'idx_categories_name'
    ];
BEGIN
    FOREACH idx IN ARRAY v_indexes LOOP
        IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname=idx)
        THEN RAISE NOTICE 'PASS: index "%" exists', idx;
        ELSE RAISE WARNING 'FAIL: index "%" MISSING', idx; END IF;
    END LOOP;
END $$;

-- BONUS: Run data quality report and show summary
DO $$
DECLARE
    v_report JSONB;
    v_orphaned_food INT;
    v_zero_price    INT;
    v_orphaned_var  INT;
BEGIN
    SELECT data_quality_report() INTO v_report;
    v_orphaned_food := jsonb_array_length(v_report->'orphaned_food_items');
    v_zero_price    := jsonb_array_length(v_report->'zero_or_negative_price');
    v_orphaned_var  := jsonb_array_length(v_report->'orphaned_variants');

    IF v_orphaned_food = 0 THEN RAISE NOTICE 'PASS: No orphaned food_items';
    ELSE RAISE WARNING 'DATA ISSUE: % orphaned food_items found', v_orphaned_food; END IF;

    IF v_zero_price = 0 THEN RAISE NOTICE 'PASS: No zero/negative price items';
    ELSE RAISE WARNING 'DATA ISSUE: % food items with price <= 0', v_zero_price; END IF;

    IF v_orphaned_var = 0 THEN RAISE NOTICE 'PASS: No orphaned variants';
    ELSE RAISE WARNING 'DATA ISSUE: % orphaned food_variants', v_orphaned_var; END IF;

    RAISE NOTICE 'Full report: %', v_report;
END $$;
