-- CreateEnum
CREATE TYPE "OrderAttributionSource" AS ENUM ('MANUAL', 'LINK');

-- AlterTable: link de venda rastreável do parceiro (nullable até o backfill)
ALTER TABLE "sales_partners" ADD COLUMN "slug" TEXT;

-- Backfill: slug a partir do nome, deduplicado por organização quando colide
WITH numbered AS (
  SELECT
    id,
    organization_id,
    trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) AS base_slug,
    row_number() OVER (
      PARTITION BY organization_id, trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
      ORDER BY created_at
    ) AS rn
  FROM "sales_partners"
)
UPDATE "sales_partners" sp
SET "slug" = CASE WHEN numbered.rn = 1 THEN numbered.base_slug ELSE numbered.base_slug || '-' || numbered.rn END
FROM numbered
WHERE sp.id = numbered.id;

ALTER TABLE "sales_partners" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "sales_partners_organization_id_slug_key" ON "sales_partners"("organization_id", "slug");

-- AlterTable: como o pedido foi atribuído ao parceiro (PDV/vendedor vs. link público)
ALTER TABLE "orders" ADD COLUMN "attribution_source" "OrderAttributionSource";
