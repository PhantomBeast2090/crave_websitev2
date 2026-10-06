-- ============================================================================
-- 020_reviews.sql
--
-- Outlet reviews + replies (new), validation guards for the existing food
-- review tables (`reviews`, `review_replies` - created outside this repo and
-- already carrying their own purchase checks), and management moderation.
--
-- Ownership chain for outlet reviews:  review -> outlet -> outlets.vendor_id
-- Hidden reviews (is_visible = false) are never returned by student- or
-- vendor-facing functions, and students/vendors cannot change visibility.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Outlet reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outlet_reviews (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id   uuid NOT NULL REFERENCES outlets(id)  ON DELETE CASCADE,
    order_id    uuid NOT NULL REFERENCES orders(id)   ON DELETE CASCADE,
    student_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review_text text CHECK (review_text IS NULL OR char_length(review_text) <= 1000),
    is_visible  boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_id)                                   -- one review per order
);
CREATE INDEX IF NOT EXISTS idx_outlet_reviews_outlet ON outlet_reviews (outlet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outlet_reviews_student ON outlet_reviews (student_id);

CREATE TABLE IF NOT EXISTS outlet_review_replies (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id   uuid NOT NULL UNIQUE REFERENCES outlet_reviews(id) ON DELETE CASCADE,
    vendor_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reply_text  text NOT NULL CHECK (char_length(btrim(reply_text)) BETWEEN 1 AND 1000),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE outlet_reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlet_review_replies ENABLE ROW LEVEL SECURITY;
SELECT crave_drop_all_policies('outlet_reviews');
SELECT crave_drop_all_policies('outlet_review_replies');

CREATE POLICY outlet_reviews_select_own    ON outlet_reviews FOR SELECT TO authenticated USING (student_id = auth.uid());
CREATE POLICY outlet_reviews_select_vendor ON outlet_reviews FOR SELECT TO authenticated USING (is_visible AND crave_owns_outlet(outlet_id));
CREATE POLICY outlet_reviews_select_admin  ON outlet_reviews FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY outlet_reviews_insert_own    ON outlet_reviews FOR INSERT TO authenticated WITH CHECK (student_id = auth.uid());
CREATE POLICY outlet_reviews_update_own    ON outlet_reviews FOR UPDATE TO authenticated USING (student_id = auth.uid()) WITH CHECK (student_id = auth.uid());
CREATE POLICY outlet_reviews_update_admin  ON outlet_reviews FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY outlet_reviews_delete_own    ON outlet_reviews FOR DELETE TO authenticated USING (student_id = auth.uid());
CREATE POLICY outlet_reviews_delete_admin  ON outlet_reviews FOR DELETE TO authenticated USING (is_admin());

-- Students see replies on their own (visible) reviews; vendors manage replies
-- on visible reviews of their own outlets; admins see everything.
CREATE POLICY orr_select_student ON outlet_review_replies FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM outlet_reviews r WHERE r.id = review_id AND r.student_id = auth.uid() AND r.is_visible));
CREATE POLICY orr_select_vendor  ON outlet_review_replies FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM outlet_reviews r WHERE r.id = review_id AND r.is_visible AND crave_owns_outlet(r.outlet_id)));
CREATE POLICY orr_select_admin   ON outlet_review_replies FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY orr_insert_vendor  ON outlet_review_replies FOR INSERT TO authenticated WITH CHECK (
    vendor_id = auth.uid() AND EXISTS (SELECT 1 FROM outlet_reviews r WHERE r.id = review_id AND r.is_visible AND crave_owns_outlet(r.outlet_id)));
CREATE POLICY orr_update_vendor  ON outlet_review_replies FOR UPDATE TO authenticated USING (
    vendor_id = auth.uid() AND EXISTS (SELECT 1 FROM outlet_reviews r WHERE r.id = review_id AND r.is_visible AND crave_owns_outlet(r.outlet_id)))
    WITH CHECK (vendor_id = auth.uid());
CREATE POLICY orr_delete_vendor  ON outlet_review_replies FOR DELETE TO authenticated USING (
    vendor_id = auth.uid() AND EXISTS (SELECT 1 FROM outlet_reviews r WHERE r.id = review_id AND crave_owns_outlet(r.outlet_id)));
CREATE POLICY orr_delete_admin   ON outlet_review_replies FOR DELETE TO authenticated USING (is_admin());

REVOKE ALL ON outlet_reviews, outlet_review_replies FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON outlet_reviews, outlet_review_replies TO authenticated;

-- NOTE: validation triggers must be SECURITY INVOKER; under SECURITY DEFINER current_user is the
-- owner and crave_is_internal() would wrongly skip every check.
CREATE OR REPLACE FUNCTION crave_validate_outlet_review() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_order record;
BEGIN
    IF crave_is_internal() THEN RETURN NEW; END IF;
    NEW.review_text := NULLIF(btrim(COALESCE(NEW.review_text, '')), '');
    IF TG_OP = 'INSERT' THEN
        IF NEW.student_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'You can only submit reviews as yourself.' USING ERRCODE = '42501';
        END IF;
        SELECT user_id, outlet_id, status::text AS status INTO v_order FROM orders WHERE id = NEW.order_id;
        IF NOT FOUND OR v_order.user_id <> auth.uid() THEN
            RAISE EXCEPTION 'You can only review outlets you ordered from.' USING ERRCODE = '42501';
        END IF;
        IF v_order.status <> 'PICKED_UP' THEN
            RAISE EXCEPTION 'You can only review completed (picked-up) orders. Status: %', v_order.status;
        END IF;
        IF v_order.outlet_id <> NEW.outlet_id THEN
            RAISE EXCEPTION 'This order was not placed at that outlet.';
        END IF;
        NEW.is_visible := true;
    ELSE
        IF NEW.student_id <> OLD.student_id OR NEW.order_id <> OLD.order_id OR NEW.outlet_id <> OLD.outlet_id THEN
            RAISE EXCEPTION 'Review ownership cannot be changed.' USING ERRCODE = '42501';
        END IF;
        IF NEW.is_visible IS DISTINCT FROM OLD.is_visible AND NOT is_admin() THEN
            RAISE EXCEPTION 'Only management can hide or restore reviews.' USING ERRCODE = '42501';
        END IF;
        IF NOT is_admin() AND (NEW.rating IS DISTINCT FROM OLD.rating OR NEW.review_text IS DISTINCT FROM OLD.review_text)
           AND NOT OLD.is_visible THEN
            RAISE EXCEPTION 'This review is hidden and cannot be edited.' USING ERRCODE = '42501';
        END IF;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crave_outlet_review_validate ON outlet_reviews;
CREATE TRIGGER crave_outlet_review_validate BEFORE INSERT OR UPDATE ON outlet_reviews
    FOR EACH ROW EXECUTE FUNCTION crave_validate_outlet_review();

CREATE OR REPLACE FUNCTION crave_validate_outlet_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
    IF crave_is_internal() THEN RETURN NEW; END IF;
    NEW.reply_text := btrim(NEW.reply_text);
    IF TG_OP = 'INSERT' THEN
        NEW.vendor_id := auth.uid();
    ELSE
        IF NEW.review_id <> OLD.review_id OR NEW.vendor_id <> OLD.vendor_id THEN
            RAISE EXCEPTION 'Reply ownership cannot be changed.' USING ERRCODE = '42501';
        END IF;
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crave_outlet_reply_validate ON outlet_review_replies;
CREATE TRIGGER crave_outlet_reply_validate BEFORE INSERT OR UPDATE ON outlet_review_replies
    FOR EACH ROW EXECUTE FUNCTION crave_validate_outlet_reply();

-- Keep outlets.rating / total_reviews in sync with VISIBLE reviews only.
CREATE OR REPLACE FUNCTION crave_refresh_outlet_rating() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_outlet uuid := COALESCE(NEW.outlet_id, OLD.outlet_id);
BEGIN
    UPDATE outlets SET
        rating = COALESCE((SELECT round(avg(rating)::numeric, 2) FROM outlet_reviews WHERE outlet_id = v_outlet AND is_visible), 0),
        total_reviews = (SELECT count(*) FROM outlet_reviews WHERE outlet_id = v_outlet AND is_visible)
    WHERE id = v_outlet;
    RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS crave_outlet_rating_sync ON outlet_reviews;
CREATE TRIGGER crave_outlet_rating_sync AFTER INSERT OR UPDATE OF rating, is_visible OR DELETE ON outlet_reviews
    FOR EACH ROW EXECUTE FUNCTION crave_refresh_outlet_rating();

-- Student-facing: visible reviews for an outlet, reviewer shown by first name only.
CREATE OR REPLACE FUNCTION get_outlet_reviews(p_outlet_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total integer; v_rows jsonb;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM outlets WHERE id = p_outlet_id AND is_active AND deleted_at IS NULL) THEN
        RETURN jsonb_build_object('total', 0, 'reviews', '[]'::jsonb);
    END IF;
    SELECT count(*) INTO v_total FROM outlet_reviews WHERE outlet_id = p_outlet_id AND is_visible;
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'created_at') DESC), '[]'::jsonb) INTO v_rows FROM (
        SELECT jsonb_build_object(
            'id', r.id, 'rating', r.rating, 'review_text', r.review_text, 'created_at', r.created_at,
            'reviewer_name', split_part(COALESCE(p.name, 'Student'), ' ', 1),
            'is_mine', r.student_id = auth.uid(),
            'reply', CASE WHEN rr.id IS NULL THEN NULL ELSE jsonb_build_object('reply_text', rr.reply_text, 'created_at', rr.created_at) END) AS x
        FROM outlet_reviews r
        JOIN profiles p ON p.id = r.student_id
        LEFT JOIN outlet_review_replies rr ON rr.review_id = r.id
        WHERE r.outlet_id = p_outlet_id AND r.is_visible
        ORDER BY r.created_at DESC
        LIMIT LEAST(GREATEST(p_limit, 1), 50) OFFSET GREATEST(p_offset, 0)) s;
    RETURN jsonb_build_object('total', v_total, 'reviews', v_rows);
END $$;

-- Vendor-facing: visible reviews on the caller's own outlets (optionally one).
CREATE OR REPLACE FUNCTION get_vendor_outlet_reviews(p_outlet_id uuid DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total integer; v_rows jsonb;
BEGIN
    IF get_user_role() IS DISTINCT FROM 'VENDOR' THEN RAISE EXCEPTION 'Only vendors can call this function.'; END IF;
    SELECT count(*) INTO v_total FROM outlet_reviews r JOIN outlets o ON o.id = r.outlet_id
     WHERE o.vendor_id = auth.uid() AND r.is_visible AND (p_outlet_id IS NULL OR r.outlet_id = p_outlet_id);
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'created_at') DESC), '[]'::jsonb) INTO v_rows FROM (
        SELECT jsonb_build_object(
            'id', r.id, 'outlet_id', r.outlet_id, 'outlet_name', o.name, 'rating', r.rating, 'review_text', r.review_text,
            'created_at', r.created_at, 'reviewer_name', split_part(COALESCE(p.name, 'Student'), ' ', 1),
            'reply', CASE WHEN rr.id IS NULL THEN NULL ELSE jsonb_build_object('id', rr.id, 'reply_text', rr.reply_text, 'created_at', rr.created_at) END) AS x
        FROM outlet_reviews r
        JOIN outlets o ON o.id = r.outlet_id AND o.vendor_id = auth.uid()
        JOIN profiles p ON p.id = r.student_id
        LEFT JOIN outlet_review_replies rr ON rr.review_id = r.id
        WHERE r.is_visible AND (p_outlet_id IS NULL OR r.outlet_id = p_outlet_id)
        ORDER BY r.created_at DESC
        LIMIT LEAST(GREATEST(p_limit, 1), 50) OFFSET GREATEST(p_offset, 0)) s;
    RETURN jsonb_build_object('total', v_total, 'reviews', v_rows);
END $$;

-- Management: search / filter / moderate.
CREATE OR REPLACE FUNCTION admin_search_outlet_reviews(
    p_search text DEFAULT NULL, p_visibility text DEFAULT 'all', p_outlet_id uuid DEFAULT NULL,
    p_rating integer DEFAULT NULL, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total integer; v_rows jsonb; v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;
    SELECT count(*) INTO v_total FROM outlet_reviews r
      JOIN outlets o ON o.id = r.outlet_id JOIN profiles p ON p.id = r.student_id
     WHERE (p_visibility = 'all' OR (p_visibility = 'visible' AND r.is_visible) OR (p_visibility = 'hidden' AND NOT r.is_visible))
       AND (p_outlet_id IS NULL OR r.outlet_id = p_outlet_id) AND (p_rating IS NULL OR r.rating = p_rating)
       AND (v_q IS NULL OR r.review_text ILIKE '%' || v_q || '%' OR o.name ILIKE '%' || v_q || '%' OR p.name ILIKE '%' || v_q || '%');
    SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'created_at') DESC), '[]'::jsonb) INTO v_rows FROM (
        SELECT jsonb_build_object(
            'id', r.id, 'outlet_id', r.outlet_id, 'outlet_name', o.name, 'rating', r.rating, 'review_text', r.review_text,
            'is_visible', r.is_visible, 'created_at', r.created_at, 'student_name', p.name,
            'reply', CASE WHEN rr.id IS NULL THEN NULL ELSE jsonb_build_object('reply_text', rr.reply_text, 'created_at', rr.created_at) END) AS x
        FROM outlet_reviews r
        JOIN outlets o ON o.id = r.outlet_id JOIN profiles p ON p.id = r.student_id
        LEFT JOIN outlet_review_replies rr ON rr.review_id = r.id
        WHERE (p_visibility = 'all' OR (p_visibility = 'visible' AND r.is_visible) OR (p_visibility = 'hidden' AND NOT r.is_visible))
          AND (p_outlet_id IS NULL OR r.outlet_id = p_outlet_id) AND (p_rating IS NULL OR r.rating = p_rating)
          AND (v_q IS NULL OR r.review_text ILIKE '%' || v_q || '%' OR o.name ILIKE '%' || v_q || '%' OR p.name ILIKE '%' || v_q || '%')
        ORDER BY r.created_at DESC
        LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0)) s;
    RETURN jsonb_build_object('total', v_total, 'reviews', v_rows);
END $$;

CREATE OR REPLACE FUNCTION admin_set_outlet_review_visibility(p_review_id uuid, p_visible boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;
    UPDATE outlet_reviews SET is_visible = p_visible, updated_at = now() WHERE id = p_review_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Review not found.'; END IF;
    INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
    VALUES (auth.uid(), CASE WHEN p_visible THEN 'REVIEW_RESTORED' ELSE 'REVIEW_HIDDEN' END, 'outlet_reviews', p_review_id, jsonb_build_object('visible', p_visible));
END $$;

SELECT crave_lock_function('get_outlet_reviews(uuid,integer,integer)',                          ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('get_vendor_outlet_reviews(uuid,integer,integer)',                   ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('admin_search_outlet_reviews(text,text,uuid,integer,integer,integer)', ARRAY['authenticated', 'service_role']);
SELECT crave_lock_function('admin_set_outlet_review_visibility(uuid,boolean)',                  ARRAY['authenticated', 'service_role']);

-- ---------------------------------------------------------------------------
-- 2. Existing FOOD review tables: validation + ownership guards.
--    (Created by the Android backend; columns probed live: reviews(student_id,
--    food_item_id, order_id, order_item_id, rating, review_text, is_visible),
--    review_replies(review_id, vendor_id, reply_text).)  Skipped if absent.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
    IF to_regclass('public.reviews') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'student_id') THEN

        CREATE OR REPLACE FUNCTION crave_validate_food_review() RETURNS trigger
        LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $f$
        BEGIN
            IF crave_is_internal() THEN RETURN NEW; END IF;
            IF NEW.rating IS NULL OR NEW.rating < 1 OR NEW.rating > 5 THEN
                RAISE EXCEPTION 'Rating must be between 1 and 5.';
            END IF;
            NEW.review_text := NULLIF(btrim(COALESCE(NEW.review_text, '')), '');
            IF char_length(COALESCE(NEW.review_text, '')) > 1000 THEN
                RAISE EXCEPTION 'Review text is limited to 1000 characters.';
            END IF;
            IF TG_OP = 'UPDATE' THEN
                IF NEW.student_id <> OLD.student_id OR NEW.order_id <> OLD.order_id
                   OR NEW.food_item_id <> OLD.food_item_id OR NEW.order_item_id IS DISTINCT FROM OLD.order_item_id THEN
                    RAISE EXCEPTION 'Review ownership cannot be changed.' USING ERRCODE = '42501';
                END IF;
                IF NEW.is_visible IS DISTINCT FROM OLD.is_visible AND NOT is_admin() THEN
                    RAISE EXCEPTION 'Only management can hide or restore reviews.' USING ERRCODE = '42501';
                END IF;
            ELSIF NEW.is_visible IS DISTINCT FROM true AND NOT is_admin() THEN
                NEW.is_visible := true;
            END IF;
            RETURN NEW;
        END $f$;
        DROP TRIGGER IF EXISTS crave_food_review_validate ON reviews;
        CREATE TRIGGER crave_food_review_validate BEFORE INSERT OR UPDATE ON reviews
            FOR EACH ROW EXECUTE FUNCTION crave_validate_food_review();
    END IF;

    IF to_regclass('public.review_replies') IS NOT NULL AND to_regclass('public.reviews') IS NOT NULL THEN
        CREATE OR REPLACE FUNCTION crave_validate_food_reply() RETURNS trigger
        LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $f$
        DECLARE v_ok boolean;
        BEGIN
            IF crave_is_internal() THEN RETURN NEW; END IF;
            NEW.reply_text := btrim(COALESCE(NEW.reply_text, ''));
            IF char_length(NEW.reply_text) < 1 OR char_length(NEW.reply_text) > 1000 THEN
                RAISE EXCEPTION 'Reply must be between 1 and 1000 characters.';
            END IF;
            IF is_admin() THEN RETURN NEW; END IF;
            IF TG_OP = 'INSERT' THEN NEW.vendor_id := auth.uid(); END IF;
            IF TG_OP = 'UPDATE' AND (NEW.review_id <> OLD.review_id OR NEW.vendor_id <> OLD.vendor_id) THEN
                RAISE EXCEPTION 'Reply ownership cannot be changed.' USING ERRCODE = '42501';
            END IF;
            SELECT EXISTS (
                SELECT 1 FROM reviews r JOIN food_items fi ON fi.id = r.food_item_id JOIN outlets o ON o.id = fi.outlet_id
                WHERE r.id = NEW.review_id AND r.is_visible AND o.vendor_id = auth.uid()
            ) INTO v_ok;
            IF NOT v_ok THEN
                RAISE EXCEPTION 'You can only reply to visible reviews of your own food.' USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END $f$;
        DROP TRIGGER IF EXISTS crave_food_reply_validate ON review_replies;
        CREATE TRIGGER crave_food_reply_validate BEFORE INSERT OR UPDATE ON review_replies
            FOR EACH ROW EXECUTE FUNCTION crave_validate_food_reply();

        CREATE OR REPLACE FUNCTION admin_set_food_review_visibility(p_review_id uuid, p_visible boolean) RETURNS void
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
        BEGIN
            IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;
            UPDATE reviews SET is_visible = p_visible, updated_at = now() WHERE id = p_review_id;
            IF NOT FOUND THEN RAISE EXCEPTION 'Review not found.'; END IF;
            INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data)
            VALUES (auth.uid(), CASE WHEN p_visible THEN 'REVIEW_RESTORED' ELSE 'REVIEW_HIDDEN' END, 'reviews', p_review_id, jsonb_build_object('visible', p_visible));
        END $f$;

        CREATE OR REPLACE FUNCTION admin_search_food_reviews(
            p_search text DEFAULT NULL, p_visibility text DEFAULT 'all', p_rating integer DEFAULT NULL,
            p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS jsonb
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f$
        DECLARE v_total integer; v_rows jsonb; v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
        BEGIN
            IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized: Requires ADMIN role.'; END IF;
            SELECT count(*) INTO v_total FROM reviews r
              JOIN food_items fi ON fi.id = r.food_item_id JOIN profiles p ON p.id = r.student_id
             WHERE (p_visibility = 'all' OR (p_visibility = 'visible' AND r.is_visible) OR (p_visibility = 'hidden' AND NOT r.is_visible))
               AND (p_rating IS NULL OR r.rating = p_rating)
               AND (v_q IS NULL OR r.review_text ILIKE '%' || v_q || '%' OR fi.name ILIKE '%' || v_q || '%' OR p.name ILIKE '%' || v_q || '%');
            SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'created_at') DESC), '[]'::jsonb) INTO v_rows FROM (
                SELECT jsonb_build_object(
                    'id', r.id, 'food_item_id', r.food_item_id, 'food_name', fi.name, 'outlet_name', o.name,
                    'rating', r.rating, 'review_text', r.review_text, 'is_visible', r.is_visible,
                    'created_at', r.created_at, 'student_name', p.name,
                    'reply', CASE WHEN rr.id IS NULL THEN NULL ELSE jsonb_build_object('reply_text', rr.reply_text, 'created_at', rr.created_at) END) AS x
                FROM reviews r
                JOIN food_items fi ON fi.id = r.food_item_id JOIN outlets o ON o.id = fi.outlet_id
                JOIN profiles p ON p.id = r.student_id
                LEFT JOIN review_replies rr ON rr.review_id = r.id
                WHERE (p_visibility = 'all' OR (p_visibility = 'visible' AND r.is_visible) OR (p_visibility = 'hidden' AND NOT r.is_visible))
                  AND (p_rating IS NULL OR r.rating = p_rating)
                  AND (v_q IS NULL OR r.review_text ILIKE '%' || v_q || '%' OR fi.name ILIKE '%' || v_q || '%' OR p.name ILIKE '%' || v_q || '%')
                ORDER BY r.created_at DESC
                LIMIT LEAST(GREATEST(p_limit, 1), 100) OFFSET GREATEST(p_offset, 0)) s;
            RETURN jsonb_build_object('total', v_total, 'reviews', v_rows);
        END $f$;

        PERFORM crave_lock_function('admin_set_food_review_visibility(uuid,boolean)',               ARRAY['authenticated', 'service_role']);
        PERFORM crave_lock_function('admin_search_food_reviews(text,text,integer,integer,integer)', ARRAY['authenticated', 'service_role']);
    END IF;
END $outer$;

COMMIT;
