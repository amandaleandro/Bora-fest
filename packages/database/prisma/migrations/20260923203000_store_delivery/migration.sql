ALTER TYPE "StoreFulfillmentMethod" ADD VALUE IF NOT EXISTS 'DELIVERY';

ALTER TABLE "organizations"
  ADD COLUMN "store_pickup_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "store_delivery_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "store_flat_shipping_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "store_delivery_instructions" TEXT;

ALTER TABLE "store_orders"
  ADD COLUMN "subtotal_cents" INTEGER,
  ADD COLUMN "shipping_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shipping_address" JSONB;

UPDATE "store_orders"
SET "subtotal_cents" = "total_cents"
WHERE "subtotal_cents" IS NULL;

ALTER TABLE "store_orders"
  ALTER COLUMN "subtotal_cents" SET NOT NULL;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_store_shipping_nonnegative_chk"
  CHECK ("store_flat_shipping_cents" >= 0);

ALTER TABLE "store_orders"
  ADD CONSTRAINT "store_orders_subtotal_nonnegative_chk"
  CHECK ("subtotal_cents" >= 0);

ALTER TABLE "store_orders"
  ADD CONSTRAINT "store_orders_shipping_nonnegative_chk"
  CHECK ("shipping_cents" >= 0);
