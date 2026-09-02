-- A derivação CONVIDADO/CORTESIA consulta guest_list_entries por order_id em
-- 4 caminhos quentes (carteira, check-in, manifesto, emissão) — sem índice era
-- seq scan por request (achado 2026-09-01).
CREATE INDEX "guest_list_entries_order_id_idx" ON "guest_list_entries" ("order_id");
