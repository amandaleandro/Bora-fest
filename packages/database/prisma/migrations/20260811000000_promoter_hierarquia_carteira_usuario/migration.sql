-- Promoter v3 (2026-08-11): hierarquia Casa → Promoter(pessoa) → Vendedor,
-- comissão nenhuma/%/fixa e CARTEIRA DE USUÁRIO (promoter comissionado recebe
-- sem ser produtor). A feature de promoter é nova e sem uso real — os vínculos
-- antigos (org↔org) são zerados com segurança.

-- 0) limpa atribuições/vínculos antigos (org-based) antes de remodelar
UPDATE "orders" SET "promoter_link_id" = NULL, "promoter_commission_cents" = 0
  WHERE "promoter_link_id" IS NOT NULL;
DELETE FROM "promoter_links";

-- 1) carteira pode ser de ORG ou de USUÁRIO
ALTER TABLE "ledger_accounts" ALTER COLUMN "organization_id" DROP NOT NULL;
ALTER TABLE "ledger_accounts" ADD COLUMN "user_id" UUID;
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_key" UNIQUE ("user_id");
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) tipo de comissão
CREATE TYPE "PromoterCommissionType" AS ENUM ('NONE', 'PERCENT', 'FIXED');

-- 3) promoter passa a ser PESSOA
ALTER TABLE "promoter_links" DROP CONSTRAINT IF EXISTS "promoter_links_organization_id_promoter_org_id_key";
ALTER TABLE "promoter_links" DROP CONSTRAINT IF EXISTS "promoter_links_promoter_org_id_fkey";
DROP INDEX IF EXISTS "promoter_links_promoter_org_id_status_idx";
ALTER TABLE "promoter_links" DROP COLUMN IF EXISTS "promoter_org_id";
ALTER TABLE "promoter_links" ADD COLUMN "promoter_user_id" UUID NOT NULL;
ALTER TABLE "promoter_links" ADD COLUMN "commission_type" "PromoterCommissionType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "promoter_links" ADD COLUMN "commission_fixed_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "promoter_links" ADD CONSTRAINT "promoter_links_organization_id_promoter_user_id_key"
  UNIQUE ("organization_id", "promoter_user_id");
CREATE INDEX "promoter_links_promoter_user_id_status_idx" ON "promoter_links" ("promoter_user_id", "status");
ALTER TABLE "promoter_links" ADD CONSTRAINT "promoter_links_promoter_user_id_fkey"
  FOREIGN KEY ("promoter_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) vendedores do promoter (nível 3)
CREATE TABLE "promoter_sellers" (
  "id"               UUID NOT NULL,
  "promoter_link_id" UUID NOT NULL,
  "seller_user_id"   UUID NOT NULL,
  "status"           "PromoterLinkStatus" NOT NULL DEFAULT 'INVITED',
  "slug"             TEXT NOT NULL,
  "invited_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at"     TIMESTAMP(3),
  CONSTRAINT "promoter_sellers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "promoter_sellers_slug_key" ON "promoter_sellers" ("slug");
CREATE UNIQUE INDEX "promoter_sellers_promoter_link_id_seller_user_id_key"
  ON "promoter_sellers" ("promoter_link_id", "seller_user_id");
CREATE INDEX "promoter_sellers_seller_user_id_status_idx" ON "promoter_sellers" ("seller_user_id", "status");
ALTER TABLE "promoter_sellers" ADD CONSTRAINT "promoter_sellers_promoter_link_id_fkey"
  FOREIGN KEY ("promoter_link_id") REFERENCES "promoter_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promoter_sellers" ADD CONSTRAINT "promoter_sellers_seller_user_id_fkey"
  FOREIGN KEY ("seller_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5) atribuição do vendedor no pedido
ALTER TABLE "orders" ADD COLUMN "promoter_seller_id" UUID;
ALTER TABLE "orders" ADD CONSTRAINT "orders_promoter_seller_id_fkey"
  FOREIGN KEY ("promoter_seller_id") REFERENCES "promoter_sellers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
