-- BF-020 / BF-021 — Ticket Studio + catálogo permanente da Casa

ALTER TABLE "events"
ADD COLUMN "ticket_theme" JSONB;

CREATE TYPE "StoreProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TABLE "store_products" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "image_url" TEXT,
  "status" "StoreProductStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "store_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "store_product_variants" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT,
  "price_cents" INTEGER NOT NULL,
  "stock_on_hand" INTEGER NOT NULL DEFAULT 0,
  "reserved_count" INTEGER NOT NULL DEFAULT 0,
  "sold_count" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "store_product_variants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_products_organization_id_slug_key"
ON "store_products"("organization_id", "slug");

CREATE INDEX "store_products_organization_id_status_idx"
ON "store_products"("organization_id", "status");

CREATE UNIQUE INDEX "store_product_variants_product_id_name_key"
ON "store_product_variants"("product_id", "name");

CREATE UNIQUE INDEX "store_product_variants_product_id_sku_key"
ON "store_product_variants"("product_id", "sku");

CREATE INDEX "store_product_variants_product_id_active_idx"
ON "store_product_variants"("product_id", "active");

ALTER TABLE "store_products"
ADD CONSTRAINT "store_products_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_product_variants"
ADD CONSTRAINT "store_product_variants_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "store_products"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "store_product_variants"
ADD CONSTRAINT "store_product_variants_stock_nonnegative"
CHECK ("stock_on_hand" >= 0 AND "reserved_count" >= 0 AND "sold_count" >= 0);

ALTER TABLE "store_product_variants"
ADD CONSTRAINT "store_product_variants_price_nonnegative"
CHECK ("price_cents" >= 0);
