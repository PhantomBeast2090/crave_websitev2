-- =============================================================================
-- Migration 007: Ordering Architecture Tests
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- Setup test data
DO $$
DECLARE
    v_vendor_id UUID;
    v_student_id UUID;
    v_outlet_id UUID;
    v_cat_id UUID;
    v_food_id UUID;
    v_variant_id UUID;
    v_option_id UUID;
    v_slot_id UUID;
    v_cart_id UUID;
    v_cart_item_id UUID;
BEGIN
    -- 1. Create a Vendor
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'testvendor_order@gag.com') RETURNING id INTO v_vendor_id;
    INSERT INTO profiles (id, role, name, phone) VALUES (v_vendor_id, 'VENDOR', 'Test Vendor', '9999999999');

    -- 2. Create a Student
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'teststudent_order@gag.com') RETURNING id INTO v_student_id;
    INSERT INTO profiles (id, role, name, phone) VALUES (v_student_id, 'STUDENT', 'Test Student', '8888888888');

    -- 3. Create an Outlet & Category
    INSERT INTO outlets (vendor_id, name, description, is_open, is_active)
    VALUES (v_vendor_id, 'Order Test Outlet', 'Testing Orders', true, true)
    RETURNING id INTO v_outlet_id;

    INSERT INTO categories (name, emoji) VALUES ('Order Test Cat', '🍔') RETURNING id INTO v_cat_id;

    -- 4. Create Food Item with Base Price = 100
    INSERT INTO food_items (outlet_id, category_id, name, description, price, is_available)
    VALUES (v_outlet_id, v_cat_id, 'Test Burger', 'Yummy', 100, true)
    RETURNING id INTO v_food_id;

    -- 5. Create Inventory
    INSERT INTO inventory (food_item_id, quantity_available) VALUES (v_food_id, 100);

    -- 6. Create Variant & Option (Extra Price = 50)
    INSERT INTO food_variants (food_item_id, name, is_required) VALUES (v_food_id, 'Size', true) RETURNING id INTO v_variant_id;
    INSERT INTO food_variant_options (variant_id, name, extra_price) VALUES (v_variant_id, 'Large', 50) RETURNING id INTO v_option_id;

    -- 7. Create Pickup Slot (Capacity 1)
    INSERT INTO pickup_slots (outlet_id, slot_date, start_time, end_time, capacity, booked_count, status)
    VALUES (v_outlet_id, CURRENT_DATE + INTERVAL '1 day', '10:00', '11:00', 1, 0, 'AVAILABLE')
    RETURNING id INTO v_slot_id;

    -- 8. Create Cart (Client tries to hack price by sending 1 instead of 100)
    INSERT INTO carts (user_id, outlet_id, subtotal, tax, total)
    VALUES (v_student_id, v_outlet_id, 1, 0, 1) RETURNING id INTO v_cart_id;

    INSERT INTO cart_items (cart_id, food_item_id, quantity, price, is_veg)
    VALUES (v_cart_id, v_food_id, 1, 1, true) RETURNING id INTO v_cart_item_id;

    -- 9. Add variant to cart
    INSERT INTO cart_item_customizations (cart_item_id, variant_id, option_id, extra_price)
    VALUES (v_cart_item_id, v_variant_id, v_option_id, 0); -- Client tries to hack extra_price to 0

    -- Save variables for tests
    PERFORM set_config('test.cart_id', v_cart_id::text, true);
    PERFORM set_config('test.slot_id', v_slot_id::text, true);
    PERFORM set_config('test.student_id', v_student_id::text, true);
END $$;

-- Switch to student context
SELECT set_config('request.jwt.claims', format('{"sub": "%s", "role": "authenticated"}', current_setting('test.student_id')), true);

-- Execute place_order
SELECT place_order(
    current_setting('test.cart_id')::UUID,
    current_setting('test.slot_id')::UUID
) INTO TEMPORARY TABLE temp_order_result;

-- TEST 1: The RPC succeeds and returns an order ID
SELECT isnt_empty(
    'SELECT * FROM temp_order_result',
    'place_order RPC successfully completed'
);

-- TEST 2: Price Security - The total should be correctly calculated from DB, ignoring cart hacks
-- Base (100) + Extra (50) = 150
-- Subtotal = 150. Tax (5%) = 7.50. Total = 157.50
SELECT results_eq(
    'SELECT subtotal, tax, total FROM orders WHERE id = (SELECT * FROM temp_order_result)',
    $$VALUES (150.00::DECIMAL, 7.50::DECIMAL, 157.50::DECIMAL)$$,
    'Price calculation is secure and ignores client spoofing (Base 100 + Variant 50 = 150)'
);

-- TEST 3: Order Item Customization insertion
SELECT results_eq(
    'SELECT variant_name, option_name, extra_price FROM order_item_customizations WHERE order_item_id = (SELECT id FROM order_items WHERE order_id = (SELECT * FROM temp_order_result))',
    $$VALUES ('Size'::TEXT, 'Large'::TEXT, 50.00::DECIMAL)$$,
    'Order item customization successfully records the authoritative DB price'
);

-- TEST 4: Pickup Slot capacity update
SELECT results_eq(
    'SELECT booked_count, status FROM pickup_slots WHERE id = ''' || current_setting('test.slot_id') || '''',
    $$VALUES (1::INTEGER, 'FULL'::pickup_slot_status)$$,
    'Pickup slot capacity decremented and marked FULL securely'
);

-- TEST 5: Cart is cleared
SELECT results_eq(
    'SELECT count(*)::int FROM cart_items WHERE cart_id = ''' || current_setting('test.cart_id') || '''',
    $$VALUES (0::INTEGER)$$,
    'Cart items successfully cleared post-order'
);

-- TEST 6: Atomic Capacity Exhaustion Rejection
-- Create another cart and try to place order for the now-FULL slot
DO $$
DECLARE
    v_cart_id UUID;
    v_food_id UUID;
BEGIN
    SELECT food_item_id INTO v_food_id FROM inventory LIMIT 1;
    INSERT INTO carts (user_id, outlet_id) VALUES (current_setting('test.student_id')::UUID, (SELECT outlet_id FROM pickup_slots WHERE id = current_setting('test.slot_id')::UUID)) RETURNING id INTO v_cart_id;
    INSERT INTO cart_items (cart_id, food_item_id, quantity, price, is_veg) VALUES (v_cart_id, v_food_id, 1, 100, true);
    PERFORM set_config('test.cart_id2', v_cart_id::text, true);
END $$;

SELECT throws_ok(
    'SELECT place_order(''' || current_setting('test.cart_id2') || '''::UUID, ''' || current_setting('test.slot_id') || '''::UUID)',
    'P0001',
    'Pickup slot is full.',
    'Overbooking rejected atomically'
);

-- TEST 7: Order Cancellation Releases Capacity
UPDATE orders SET status = 'CANCELLED' WHERE id = (SELECT * FROM temp_order_result);

SELECT results_eq(
    'SELECT booked_count, status FROM pickup_slots WHERE id = ''' || current_setting('test.slot_id') || '''',
    $$VALUES (0::INTEGER, 'AVAILABLE'::pickup_slot_status)$$,
    'Canceling an order securely releases the pickup slot capacity via Trigger'
);

SELECT * FROM finish();
ROLLBACK;
