-- Ingresso restrito a convidados + evento privado + limite por CPF (2026-10-10).
-- Só adiciona colunas com padrão: nenhum dado existente muda.

-- CreateEnum
CREATE TYPE "LotInviteMode" AS ENUM ('NONE', 'LINK');

-- AlterTable
ALTER TABLE "events" ADD COLUMN "is_private" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ticket_lots" ADD COLUMN "invite_mode" "LotInviteMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN "invite_token" TEXT,
ADD COLUMN "limit_per_cpf" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "contact_cpf" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ticket_lots_invite_token_key" ON "ticket_lots"("invite_token");

-- CreateIndex
CREATE INDEX "orders_contact_cpf_idx" ON "orders"("contact_cpf");
