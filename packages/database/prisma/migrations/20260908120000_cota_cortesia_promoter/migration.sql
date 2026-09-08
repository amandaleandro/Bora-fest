-- Cota de cortesia por promoter (2026-09-08). Antes, o limite era a capacidade
-- do lote, compartilhada entre todos: um promoter sozinho podia consumir a cota
-- inteira da casa. Default 0 = ninguém ganha cortesia sem a casa conceder.
ALTER TABLE "promoter_links" ADD COLUMN "guest_quota" INTEGER NOT NULL DEFAULT 0;
