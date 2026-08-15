-- Promoter com escopo por EVENTO (decisão 2026-08-15): null = todos os eventos
-- da casa (comportamento antigo); preenchido = o link só atribui/comissiona
-- naquele evento. Links existentes ficam null (nada muda para eles).
ALTER TABLE "promoter_links" ADD COLUMN "event_id" UUID REFERENCES "events"("id") ON DELETE CASCADE;
CREATE INDEX "promoter_links_event_id_idx" ON "promoter_links"("event_id");
