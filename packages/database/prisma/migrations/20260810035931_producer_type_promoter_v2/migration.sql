-- CreateEnum
CREATE TYPE "ProducerType" AS ENUM ('CASA', 'ATLETICA', 'PRODUTORA', 'INDEPENDENTE', 'OUTRO');

-- CreateEnum
CREATE TYPE "PromoterLinkStatus" AS ENUM ('INVITED', 'ACTIVE', 'DECLINED', 'REMOVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'COMMISSION_DEBIT';
ALTER TYPE "LedgerEntryType" ADD VALUE 'COMMISSION_CREDIT';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "promoter_commission_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "promoter_link_id" UUID;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "producer_type" "ProducerType";

-- CreateTable
CREATE TABLE "promoter_links" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "promoter_org_id" UUID NOT NULL,
    "status" "PromoterLinkStatus" NOT NULL DEFAULT 'INVITED',
    "commission_bps" INTEGER NOT NULL DEFAULT 0,
    "slug" TEXT NOT NULL,
    "invited_by" UUID,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "promoter_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "promoter_links_slug_key" ON "promoter_links"("slug");

-- CreateIndex
CREATE INDEX "promoter_links_promoter_org_id_status_idx" ON "promoter_links"("promoter_org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "promoter_links_organization_id_promoter_org_id_key" ON "promoter_links"("organization_id", "promoter_org_id");

-- AddForeignKey
ALTER TABLE "promoter_links" ADD CONSTRAINT "promoter_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promoter_links" ADD CONSTRAINT "promoter_links_promoter_org_id_fkey" FOREIGN KEY ("promoter_org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_promoter_link_id_fkey" FOREIGN KEY ("promoter_link_id") REFERENCES "promoter_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;
