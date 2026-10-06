-- ============================================================================
-- 022_fix_food_veg_flags.sql   (DATA FIX)
--
-- Found during the audit: on the live database EVERY menu item was flagged is_veg = true
-- (1,397 of 1,397), including ~400 chicken / egg / mutton / fish items. Migration 015 only
-- corrected rows where is_veg IS NULL, but the column had defaulted to true during import,
-- so it never touched them. Students therefore saw non-vegetarian food marked vegetarian and the
-- "vegetarian" filter returned everything.
--
-- This only ever moves rows from veg -> non-veg (the safe direction for a food label) using two
-- conservative signals. Vendors / management can flip an individual item back.
--   A) the item NAME contains a clear non-veg word (chicken, mutton, fish, prawn, egg, beef, ...)
--      unless it is a known false positive (eggless, eggplant);
--   B) the CATEGORY is a non-veg category (Non-Veg ..., Chicken ..., Egg, Mutton, Fish, Seafood)
--      and the name has no veg marker (mushroom, paneer, veg, soya, aloo, gobi, corn).
-- ============================================================================
BEGIN;

UPDATE food_items f
SET is_veg = false, updated_at = now()
FROM categories c
WHERE c.id = f.category_id
  AND f.is_veg
  AND (
        (f.name ~* '\m(chicken|mutton|fish|prawns?|eggs?|beef|meat|lamb|crab|squid|shrimp|seafood|omelet|omelette|omlette|pork|bacon|salami|tuna)\M'
         AND f.name !~* '(eggless|egg less|egg-less|eggplant|egg plant)')
     OR (c.name ~* '(non[- ]?veg|chicken|\megg\M|mutton|fish|seafood|prawn)'
         AND f.name !~* '(mushroom|paneer|\mveg\M|soya|aloo|gobi|corn)')
      );

COMMIT;
