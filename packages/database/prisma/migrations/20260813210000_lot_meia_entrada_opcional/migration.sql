-- meia-entrada vira OPT-IN por lote (antes era oferecida sempre ao comprador).
-- Lotes existentes ficam com false: o produtor liga onde quiser.
ALTER TABLE "ticket_lots" ADD COLUMN "half_price_enabled" BOOLEAN NOT NULL DEFAULT false;
