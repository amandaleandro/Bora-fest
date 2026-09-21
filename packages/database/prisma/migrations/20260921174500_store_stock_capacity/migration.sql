-- Reforça a invariável de estoque sem reescrever a migration que criou a Loja.
-- Seguro para ambientes que já aplicaram 20260921163000_ticket_theme_store_catalog.

ALTER TABLE "store_product_variants"
DROP CONSTRAINT IF EXISTS "store_product_variants_stock_capacity";

ALTER TABLE "store_product_variants"
ADD CONSTRAINT "store_product_variants_stock_capacity"
CHECK ("stock_total" >= "reserved_count" + "sold_count");
