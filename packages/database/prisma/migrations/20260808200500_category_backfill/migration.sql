-- Categoria virou obrigatória no cadastro (2026-08-08). Eventos criados
-- antes ficam como FESTAS — retrato fiel do catálogo atual (open de
-- atlética); o produtor pode ajustar na edição.
UPDATE "events" SET "category" = 'FESTAS' WHERE "category" IS NULL;
