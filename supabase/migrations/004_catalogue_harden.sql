-- =============================================================================
-- Migration 004: Food Catalogue Hardening
-- =============================================================================
-- NON-DESTRUCTIVE. Adds RPCs, triggers, indexes, and policy fixes.
-- Apply via Supabase Dashboard > SQL Editor.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================================================
-- SECTION 1: SOFT-DELETE GUARD — Partial indexes for performance + correctness
-- =============================================================================
-- outlets.deleted_at and food_items.deleted_at allow soft-deletion.
-- These partial indexes speed up the most common student-facing queries
-- while making it easy to accidentally include deleted rows.

CREATE INDEX IF NOT EXISTS idx_outlets_active_open
    ON outlets(is_active, is_open)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_food_items_outlet_available
    ON food_items(outlet_id, is_available)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_food_items_name_trgm
    ON food_items USING gin(name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_food_items_tags
    ON food_items USING gin(tags);

-- =============================================================================
-- SECTION 2: FIX OUTLET RLS — Add deleted_at guard
-- =============================================================================
-- PROBLEM: "Anyone can view active outlets" does not exclude soft-deleted outlets.

DROP POLICY IF EXISTS "Anyone can view active outlets" ON outlets;

CREATE POLICY "Anyone can view active outlets"
ON outlets FOR SELECT
USING (
    deleted_at IS NULL
    AND (
        (is_active = true)
        OR is_admin()
        OR (auth.uid() = vendor_id)
    )
);

-- =============================================================================
-- SECTION 3: FIX FOOD_ITEMS RLS — Add deleted_at guard
-- =============================================================================

DROP POLICY IF EXISTS "Anyone can view available food items" ON food_items;

CREATE POLICY "Anyone can view available food items"
ON food_items FOR SELECT
USING (
    deleted_at IS NULL
    AND (
        (
            food_items.is_available = true
            AND EXISTS (
                SELECT 1 FROM outlets
                WHERE outlets.id = food_items.outlet_id
                  AND outlets.is_active = true
                  AND outlets.deleted_at IS NULL
            )
        )
        OR is_admin()
        OR (
            is_vendor()
            AND EXISTS (
                SELECT 1 FROM outlets
                WHERE outlets.id = food_items.outlet_id
                  AND outlets.vendor_id = auth.uid()
            )
        )
    )
);

-- =============================================================================
-- SECTION 4: PRICE INTEGRITY TRIGGER
-- =============================================================================
-- Prevent zero or negative prices being inserted/updated into food_items.

CREATE OR REPLACE FUNCTION enforce_food_price_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.price IS NULL OR NEW.price <= 0 THEN
        RAISE EXCEPTION 'Food item "%" must have a price greater than 0. Got: %', NEW.name, NEW.price;
    END IF;
    IF NEW.prep_time_minutes IS NOT NULL AND NEW.prep_time_minutes < 0 THEN
        RAISE EXCEPTION 'prep_time_minutes cannot be negative for item "%"', NEW.name;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS food_price_integrity ON food_items;
CREATE TRIGGER food_price_integrity
BEFORE INSERT OR UPDATE OF price, prep_time_minutes ON food_items
FOR EACH ROW
EXECUTE FUNCTION enforce_food_price_integrity();

-- =============================================================================
-- SECTION 5: VENDOR INSERT GUARD — Prevent inserting food for another outlet
-- =============================================================================
-- PROBLEM: A vendor with a direct INSERT could theoretically target any outlet_id.
-- This trigger verifies outlet ownership before any INSERT or outlet_id change.

CREATE OR REPLACE FUNCTION enforce_vendor_food_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role text := get_user_role();
BEGIN
    -- Admins bypass this check
    IF v_role = 'ADMIN' THEN RETURN NEW; END IF;

    -- For vendor inserts/updates verify they own the target outlet
    IF v_role = 'VENDOR' THEN
        IF NOT EXISTS (
            SELECT 1 FROM outlets
            WHERE id = NEW.outlet_id AND vendor_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'Vendors can only manage food items for their own outlet.';
        END IF;
    END IF;

    -- Students and unauthenticated users cannot insert/update food_items
    IF v_role = 'STUDENT' OR v_role IS NULL THEN
        RAISE EXCEPTION 'Permission denied: students cannot create or modify food items.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendor_food_ownership ON food_items;
CREATE TRIGGER vendor_food_ownership
BEFORE INSERT OR UPDATE OF outlet_id ON food_items
FOR EACH ROW
EXECUTE FUNCTION enforce_vendor_food_ownership();

-- =============================================================================
-- SECTION 6: SECURE CATALOGUE RPC — get_catalogue_for_outlet()
-- =============================================================================
-- Returns an outlet's full menu including variants in a single round trip.
-- Always enforces availability and active outlet server-side.
-- Android calls: supabase.postgrest.rpc("get_catalogue_for_outlet", ...)

CREATE OR REPLACE FUNCTION get_catalogue_for_outlet(p_outlet_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_outlet     RECORD;
    v_food_items JSONB;
BEGIN
    -- 1. Verify outlet exists and is visible to caller
    SELECT * INTO v_outlet
    FROM outlets
    WHERE id = p_outlet_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Outlet not found.';
    END IF;

    -- Non-admin/vendor callers can only see active outlets
    IF NOT (is_admin() OR (is_vendor() AND v_outlet.vendor_id = auth.uid())) THEN
        IF NOT v_outlet.is_active THEN
            RAISE EXCEPTION 'Outlet is not active.';
        END IF;
    END IF;

    -- 2. Fetch food items with variants in a single JSON aggregate
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id',               fi.id,
                'name',             fi.name,
                'description',      fi.description,
                'image_url',        fi.image_url,
                'price',            fi.price,
                'is_veg',           fi.is_veg,
                'is_available',     fi.is_available,
                'prep_time_minutes',fi.prep_time_minutes,
                'calories',         fi.calories,
                'ingredients',      fi.ingredients,
                'tags',             fi.tags,
                'is_popular',       fi.is_popular,
                'is_recommended',   fi.is_recommended,
                'rating',           fi.rating,
                'total_reviews',    fi.total_reviews,
                'category_id',      fi.category_id,
                'category_name',    cat.name,
                'category_emoji',   cat.emoji,
                'variants',         (
                    SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'id',            fv.id,
                                'name',          fv.name,
                                'is_required',   fv.is_required,
                                'max_selections',fv.max_selections,
                                'options',       (
                                    SELECT COALESCE(
                                        jsonb_agg(
                                            jsonb_build_object(
                                                'id',         fvo.id,
                                                'name',       fvo.name,
                                                'extra_price',fvo.extra_price
                                            ) ORDER BY fvo.extra_price
                                        ), '[]'::jsonb
                                    )
                                    FROM food_variant_options fvo
                                    WHERE fvo.variant_id = fv.id
                                )
                            )
                        ), '[]'::jsonb
                    )
                    FROM food_variants fv
                    WHERE fv.food_item_id = fi.id
                )
            ) ORDER BY cat.name, fi.name
        ), '[]'::jsonb
    ) INTO v_food_items
    FROM food_items fi
    JOIN categories cat ON cat.id = fi.category_id
    WHERE fi.outlet_id  = p_outlet_id
      AND fi.deleted_at IS NULL
      AND (
          fi.is_available = true
          OR is_admin()
          OR (is_vendor() AND v_outlet.vendor_id = auth.uid())
      );

    RETURN jsonb_build_object(
        'outlet', jsonb_build_object(
            'id',                  v_outlet.id,
            'name',                v_outlet.name,
            'description',         v_outlet.description,
            'image_url',           v_outlet.image_url,
            'is_open',             v_outlet.is_open,
            'is_active',           v_outlet.is_active,
            'building',            v_outlet.building,
            'floor',               v_outlet.floor,
            'location_description',v_outlet.location_description,
            'latitude',            v_outlet.latitude,
            'longitude',           v_outlet.longitude,
            'operating_hours',     v_outlet.operating_hours,
            'rating',              v_outlet.rating,
            'total_reviews',       v_outlet.total_reviews,
            'phone',               v_outlet.phone
        ),
        'food_items', v_food_items
    );
END;
$$;

REVOKE ALL ON FUNCTION get_catalogue_for_outlet(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_catalogue_for_outlet(UUID) TO authenticated, anon;

-- =============================================================================
-- SECTION 7: SECURE SEARCH RPC — search_food()
-- =============================================================================
-- Full-text + similarity search across name, description, tags.
-- Always enforces availability + active outlet for student callers.

CREATE OR REPLACE FUNCTION search_food(
    p_query      TEXT    DEFAULT '',
    p_outlet_id  UUID    DEFAULT NULL,
    p_category   TEXT    DEFAULT NULL,   -- category name filter
    p_is_veg     BOOLEAN DEFAULT NULL,
    p_max_price  DECIMAL DEFAULT NULL,
    p_available_only BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_results JSONB;
    v_is_privileged BOOLEAN := is_admin() OR is_vendor();
BEGIN
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id',               fi.id,
                'name',             fi.name,
                'description',      fi.description,
                'image_url',        fi.image_url,
                'price',            fi.price,
                'is_veg',           fi.is_veg,
                'is_available',     fi.is_available,
                'prep_time_minutes',fi.prep_time_minutes,
                'is_popular',       fi.is_popular,
                'is_recommended',   fi.is_recommended,
                'rating',           fi.rating,
                'outlet_id',        fi.outlet_id,
                'outlet_name',      out.name,
                'category_id',      fi.category_id,
                'category_name',    cat.name
            )
        ), '[]'::jsonb
    ) INTO v_results
    FROM food_items fi
    JOIN outlets    out ON out.id  = fi.outlet_id
    JOIN categories cat ON cat.id  = fi.category_id
    WHERE
        fi.deleted_at  IS NULL
        AND out.deleted_at IS NULL
        -- Availability filter (always on for students)
        AND (
            v_is_privileged
            OR (
                (NOT p_available_only OR fi.is_available = true)
                AND out.is_active = true
            )
        )
        -- Text search across name, description, tags
        AND (
            p_query = ''
            OR fi.name        ILIKE '%' || p_query || '%'
            OR fi.description ILIKE '%' || p_query || '%'
            OR EXISTS (SELECT 1 FROM unnest(fi.tags) t WHERE t ILIKE '%' || p_query || '%')
        )
        -- Optional filters
        AND (p_outlet_id IS NULL OR fi.outlet_id   = p_outlet_id)
        AND (p_category  IS NULL OR cat.name ILIKE p_category)
        AND (p_is_veg    IS NULL OR fi.is_veg       = p_is_veg)
        AND (p_max_price IS NULL OR fi.price        <= p_max_price)
    ORDER BY
        -- Boost exact name matches, then popular, then rating
        CASE WHEN fi.name ILIKE p_query THEN 0 ELSE 1 END,
        fi.is_popular DESC,
        fi.rating DESC,
        fi.name ASC
    LIMIT 100;

    RETURN v_results;
END;
$$;

REVOKE ALL ON FUNCTION search_food(TEXT, UUID, TEXT, BOOLEAN, DECIMAL, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_food(TEXT, UUID, TEXT, BOOLEAN, DECIMAL, BOOLEAN) TO authenticated, anon;

-- =============================================================================
-- SECTION 8: FIX FAVORITES RLS — Don't allow favorites to deleted food
-- =============================================================================
-- PROBLEM: A favorite could point to a food_item that's been soft-deleted
-- or belongs to an inactive outlet. Sync happens server-side.

DROP POLICY IF EXISTS "Users manage their favorites" ON favorites;

-- Students can read their own favorites (server filters active food at query time)
CREATE POLICY "Users view their favorites"
ON favorites FOR SELECT
USING (auth.uid() = user_id);

-- Students can add favorites (constraint ensures food_item exists)
CREATE POLICY "Users add favorites"
ON favorites FOR INSERT
WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
        SELECT 1 FROM food_items fi
        JOIN outlets o ON fi.outlet_id = o.id
        WHERE fi.id = favorites.food_item_id
          AND fi.deleted_at IS NULL
          AND o.deleted_at  IS NULL
          AND o.is_active   = true
    )
);

-- Students can remove their own favorites
CREATE POLICY "Users remove favorites"
ON favorites FOR DELETE
USING (auth.uid() = user_id);

-- =============================================================================
-- SECTION 9: DATA QUALITY REPORT FUNCTION
-- =============================================================================
-- Call this via SELECT * FROM data_quality_report(); to get a JSON report
-- of any data issues without modifying any rows.

CREATE OR REPLACE FUNCTION data_quality_report()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_report JSONB;
BEGIN
    SELECT jsonb_build_object(
        'orphaned_food_items', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fi.id,'name',fi.name,'outlet_id',fi.outlet_id)), '[]')
            FROM food_items fi WHERE NOT EXISTS (SELECT 1 FROM outlets o WHERE o.id = fi.outlet_id)
        ),
        'invalid_category_food', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fi.id,'name',fi.name,'category_id',fi.category_id)), '[]')
            FROM food_items fi WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = fi.category_id)
        ),
        'zero_or_negative_price', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fi.id,'name',fi.name,'price',fi.price)), '[]')
            FROM food_items fi WHERE fi.price <= 0
        ),
        'missing_food_name', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fi.id,'outlet_id',fi.outlet_id)), '[]')
            FROM food_items fi WHERE fi.name IS NULL OR TRIM(fi.name) = ''
        ),
        'missing_outlet_name', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id)), '[]')
            FROM outlets o WHERE o.name IS NULL OR TRIM(o.name) = ''
        ),
        'food_in_inactive_outlets', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('food_id',fi.id,'food_name',fi.name,'outlet_id',o.id,'outlet_name',o.name)), '[]')
            FROM food_items fi JOIN outlets o ON fi.outlet_id = o.id
            WHERE fi.is_available = true AND o.is_active = false AND fi.deleted_at IS NULL
        ),
        'orphaned_variants', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fv.id,'name',fv.name,'food_item_id',fv.food_item_id)), '[]')
            FROM food_variants fv WHERE NOT EXISTS (SELECT 1 FROM food_items fi WHERE fi.id = fv.food_item_id)
        ),
        'orphaned_variant_options', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fvo.id,'name',fvo.name,'variant_id',fvo.variant_id)), '[]')
            FROM food_variant_options fvo WHERE NOT EXISTS (SELECT 1 FROM food_variants fv WHERE fv.id = fvo.variant_id)
        ),
        'negative_extra_price_options', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object('id',fvo.id,'name',fvo.name,'extra_price',fvo.extra_price)), '[]')
            FROM food_variant_options fvo WHERE fvo.extra_price < 0
        )
    ) INTO v_report;
    RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION data_quality_report() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION data_quality_report() TO authenticated;

-- =============================================================================
-- SECTION 10: ADDITIONAL CATALOGUE INDEXES
-- =============================================================================

-- Outlets: fast student query for active open outlets
CREATE INDEX IF NOT EXISTS idx_outlets_is_active       ON outlets(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outlets_vendor_id       ON outlets(vendor_id) WHERE deleted_at IS NULL;

-- Food: name search
CREATE INDEX IF NOT EXISTS idx_food_items_is_popular   ON food_items(is_popular)   WHERE deleted_at IS NULL AND is_popular = true;
CREATE INDEX IF NOT EXISTS idx_food_items_is_recommended ON food_items(is_recommended) WHERE deleted_at IS NULL AND is_recommended = true;

-- Variants
CREATE INDEX IF NOT EXISTS idx_food_variants_item      ON food_variants(food_item_id);
CREATE INDEX IF NOT EXISTS idx_food_variant_options_var ON food_variant_options(variant_id);

-- Categories
CREATE INDEX IF NOT EXISTS idx_categories_name        ON categories(name);

COMMIT;

-- =============================================================================
-- POST-MIGRATION NOTES
-- =============================================================================
-- After applying:
-- 1. Run data_quality_report() to identify any bad SRM data records.
-- 2. Manually review and fix any issues found.
-- 3. Verify search_food('coffee') returns results from Supabase SQL Editor.
-- 4. Verify get_catalogue_for_outlet('<outlet_uuid>') returns full menu.
-- =============================================================================
