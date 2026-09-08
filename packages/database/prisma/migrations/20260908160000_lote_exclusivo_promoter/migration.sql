-- Lote exclusivo do promoter (2026-09-08): so aparece para quem chegou pelo
-- link/codigo de um promoter. Preco especial de quem compra "com o fulano",
-- sem furar a tabela publica. Benchmark: Shotgun e Fatsoma tem equivalente.
ALTER TABLE "ticket_lots" ADD COLUMN "promoter_only" BOOLEAN NOT NULL DEFAULT false;
