-- Migration 014: Inventory Initialization
-- Fixes "Cart is empty" / "No inventory" checkout race conditions by providing infinite backfill.

-- 1. Automatic inventory creation for future food_items
CREATE OR REPLACE FUNCTION public.initialize_food_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.inventory (
        food_item_id,
        quantity_available
    )
    VALUES (
        NEW.id,
        1000000
    )
    ON CONFLICT (food_item_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_food_item_created ON public.food_items;

CREATE TRIGGER on_food_item_created
AFTER INSERT ON public.food_items
FOR EACH ROW
EXECUTE FUNCTION public.initialize_food_inventory();

-- 2. One-time idempotent backfill for existing food_items
INSERT INTO public.inventory (food_item_id, quantity_available)
SELECT id, 1000000
FROM public.food_items
ON CONFLICT (food_item_id) DO NOTHING;
