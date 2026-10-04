BEGIN;

-- Recover dietary classification for existing production food items.
UPDATE public.food_items fi
SET is_veg = false
FROM public.categories c
WHERE fi.category_id = c.id
  AND fi.is_veg IS NULL
  AND (
      fi.name ILIKE '%chicken%'
      OR fi.name ILIKE '%egg%'
      OR fi.name ILIKE '%mutton%'
      OR fi.name ILIKE '%fish%'
      OR fi.name ILIKE '%prawn%'
      OR fi.name ILIKE '%meat%'
      OR fi.name ILIKE '%beef%'
      OR c.name ILIKE '%non-veg%'
  );

-- Remaining NULL values are vegetarian based on the completed audit.
UPDATE public.food_items
SET is_veg = true
WHERE is_veg IS NULL;

-- Restore the intended schema invariant.
ALTER TABLE public.food_items
ALTER COLUMN is_veg SET DEFAULT true;

ALTER TABLE public.food_items
ALTER COLUMN is_veg SET NOT NULL;

COMMIT;
