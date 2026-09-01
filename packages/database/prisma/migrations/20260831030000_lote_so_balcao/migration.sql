-- Lote "só balcão" (2026-08-31, cortesia de novatos via promoter): não aparece
-- no site nem entra em reserva pública — só a venda presencial da portaria
-- (PDV, exige SALES_PERFORM) enxerga e emite.
ALTER TABLE "ticket_lots" ADD COLUMN "pdv_only" BOOLEAN NOT NULL DEFAULT false;
