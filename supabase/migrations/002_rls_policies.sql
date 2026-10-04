-- Phase 2: Row Level Security (RLS) Policies for GaG

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_variant_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_item_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item_customizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper functions for Role checking
CREATE OR REPLACE FUNCTION get_user_role() RETURNS text AS $$
    SELECT role::text FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean AS $$
    SELECT get_user_role() = 'ADMIN';
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_vendor() RETURNS boolean AS $$
    SELECT get_user_role() = 'VENDOR';
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_student() RETURNS boolean AS $$
    SELECT get_user_role() = 'STUDENT';
$$ LANGUAGE sql SECURITY DEFINER;

-- 1. Profiles
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins have full access to profiles" ON profiles FOR ALL USING (is_admin());
CREATE POLICY "Vendors can view student profiles attached to their orders" ON profiles FOR SELECT USING (is_vendor()); -- Simplified, vendors might need to see names

-- 2. Outlets
CREATE POLICY "Anyone can view active outlets" ON outlets FOR SELECT USING (is_active = true OR is_admin() OR (auth.uid() = vendor_id));
CREATE POLICY "Vendors can manage their own outlets" ON outlets FOR ALL USING (auth.uid() = vendor_id);
CREATE POLICY "Admins have full access to outlets" ON outlets FOR ALL USING (is_admin());

-- 3. Categories
CREATE POLICY "Anyone can view categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Admins manage categories" ON categories FOR ALL USING (is_admin());

-- 4. Food Items
CREATE POLICY "Anyone can view active food items" ON food_items FOR SELECT USING (
    is_available = true AND 
    EXISTS (SELECT 1 FROM outlets WHERE outlets.id = food_items.outlet_id AND outlets.is_active = true) 
    OR is_admin() 
    OR (is_vendor() AND EXISTS (SELECT 1 FROM outlets WHERE outlets.id = food_items.outlet_id AND outlets.vendor_id = auth.uid()))
);
CREATE POLICY "Vendors manage their food items" ON food_items FOR ALL USING (
    EXISTS (SELECT 1 FROM outlets WHERE outlets.id = food_items.outlet_id AND outlets.vendor_id = auth.uid())
);
CREATE POLICY "Admins have full access to food items" ON food_items FOR ALL USING (is_admin());

-- 5. Food Variants & Options
CREATE POLICY "Anyone can view variants" ON food_variants FOR SELECT USING (true);
CREATE POLICY "Vendors manage variants" ON food_variants FOR ALL USING (
    EXISTS (SELECT 1 FROM food_items JOIN outlets ON food_items.outlet_id = outlets.id WHERE food_items.id = food_variants.food_item_id AND outlets.vendor_id = auth.uid())
);
CREATE POLICY "Admins manage variants" ON food_variants FOR ALL USING (is_admin());

CREATE POLICY "Anyone can view variant options" ON food_variant_options FOR SELECT USING (true);
CREATE POLICY "Vendors manage variant options" ON food_variant_options FOR ALL USING (
    EXISTS (SELECT 1 FROM food_variants JOIN food_items ON food_variants.food_item_id = food_items.id JOIN outlets ON food_items.outlet_id = outlets.id WHERE food_variants.id = food_variant_options.variant_id AND outlets.vendor_id = auth.uid())
);
CREATE POLICY "Admins manage variant options" ON food_variant_options FOR ALL USING (is_admin());

-- 6. Inventory
CREATE POLICY "Anyone can view inventory" ON inventory FOR SELECT USING (true);
CREATE POLICY "Vendors manage their inventory" ON inventory FOR ALL USING (
    EXISTS (SELECT 1 FROM food_items JOIN outlets ON food_items.outlet_id = outlets.id WHERE food_items.id = inventory.food_item_id AND outlets.vendor_id = auth.uid())
);
CREATE POLICY "Admins manage inventory" ON inventory FOR ALL USING (is_admin());

-- 7. Carts & Cart Items
CREATE POLICY "Users can manage their own cart" ON carts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their cart items" ON cart_items FOR ALL USING (
    EXISTS (SELECT 1 FROM carts WHERE carts.id = cart_items.cart_id AND carts.user_id = auth.uid())
);
CREATE POLICY "Users can manage their cart item customizations" ON cart_item_customizations FOR ALL USING (
    EXISTS (SELECT 1 FROM cart_items JOIN carts ON cart_items.cart_id = carts.id WHERE cart_items.id = cart_item_customizations.cart_item_id AND carts.user_id = auth.uid())
);

-- 8. Pickup Slots
CREATE POLICY "Anyone can view pickup slots" ON pickup_slots FOR SELECT USING (true);
CREATE POLICY "Vendors manage their slots" ON pickup_slots FOR ALL USING (
    EXISTS (SELECT 1 FROM outlets WHERE outlets.id = pickup_slots.outlet_id AND outlets.vendor_id = auth.uid())
);
CREATE POLICY "Admins manage pickup slots" ON pickup_slots FOR ALL USING (is_admin());

-- 9. Orders & Order Items
CREATE POLICY "Users view their own orders" ON orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create their own orders" ON orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can cancel their own pending orders" ON orders FOR UPDATE USING (auth.uid() = user_id AND status IN ('CREATED', 'PLACED'));
CREATE POLICY "Vendors manage their outlet's orders" ON orders FOR ALL USING (auth.uid() = vendor_id);
CREATE POLICY "Admins manage all orders" ON orders FOR ALL USING (is_admin());

CREATE POLICY "Users view their order items" ON order_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
);
CREATE POLICY "Users create order items" ON order_items FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
);
CREATE POLICY "Vendors view their order items" ON order_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.vendor_id = auth.uid())
);
CREATE POLICY "Admins manage all order items" ON order_items FOR ALL USING (is_admin());

CREATE POLICY "Users view their order customizations" ON order_item_customizations FOR SELECT USING (
    EXISTS (SELECT 1 FROM order_items JOIN orders ON order_items.order_id = orders.id WHERE order_items.id = order_item_customizations.order_item_id AND orders.user_id = auth.uid())
);
CREATE POLICY "Users create order customizations" ON order_item_customizations FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM order_items JOIN orders ON order_items.order_id = orders.id WHERE order_items.id = order_item_customizations.order_item_id AND orders.user_id = auth.uid())
);
CREATE POLICY "Vendors view order customizations" ON order_item_customizations FOR SELECT USING (
    EXISTS (SELECT 1 FROM order_items JOIN orders ON order_items.order_id = orders.id WHERE order_items.id = order_item_customizations.order_item_id AND orders.vendor_id = auth.uid())
);

-- 10. Payments
CREATE POLICY "Users view their payments" ON payments FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = payments.order_id AND orders.user_id = auth.uid())
);
CREATE POLICY "Vendors view their payments" ON payments FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = payments.order_id AND orders.vendor_id = auth.uid())
);
CREATE POLICY "Admins manage payments" ON payments FOR ALL USING (is_admin());

-- 11. Pickup Tokens
CREATE POLICY "Vendors view tokens for their orders" ON pickup_tokens FOR ALL USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = pickup_tokens.order_id AND orders.vendor_id = auth.uid())
);
CREATE POLICY "Admins manage pickup tokens" ON pickup_tokens FOR ALL USING (is_admin());

-- 12. Favorites
CREATE POLICY "Users manage their favorites" ON favorites FOR ALL USING (auth.uid() = user_id);

-- 13. Reviews
CREATE POLICY "Anyone can view reviews" ON reviews FOR SELECT USING (true);
CREATE POLICY "Users can create and edit their own reviews" ON reviews FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins manage reviews" ON reviews FOR ALL USING (is_admin());

-- 14. Notifications
CREATE POLICY "Users manage their notifications" ON notifications FOR ALL USING (auth.uid() = user_id);

-- 15. Coupons
CREATE POLICY "Anyone can view active coupons" ON coupons FOR SELECT USING (is_active = true);
CREATE POLICY "Admins manage coupons" ON coupons FOR ALL USING (is_admin());

-- 16. Audit Logs
CREATE POLICY "Only admins can view audit logs" ON audit_logs FOR SELECT USING (is_admin());
-- Insert is usually done via database triggers running as SECURITY DEFINER
