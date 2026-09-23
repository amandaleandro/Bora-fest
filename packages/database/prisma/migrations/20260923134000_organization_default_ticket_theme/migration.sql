-- Tema padrão do ingresso por Casa.
-- Eventos com ticket_theme próprio continuam sobrescrevendo este valor.

ALTER TABLE "organizations"
ADD COLUMN "default_ticket_theme" JSONB;
