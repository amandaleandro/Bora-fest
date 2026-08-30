-- Proteção de reembolso (upsell 2026-08-30): +R$1,50 por compra permite
-- reembolso do ingresso mesmo após o prazo, até o início do evento. O prêmio
-- é lucro do produtor e nunca é reembolsado; o valor do ingresso fica retido
-- (janela de liberação normal) então o produtor nunca paga do bolso.
ALTER TABLE "orders" ADD COLUMN "protection_purchased" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "orders" ADD COLUMN "protection_fee_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TYPE "LedgerEntryType" ADD VALUE 'PROTECTION_CREDIT';
