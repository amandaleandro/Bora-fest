-- Codigo pessoal do promoter (2026-09-08). O link depende de localStorage de 7
-- dias, que se perde ao trocar de aparelho ou abrir em navegador in-app. O
-- codigo e deterministico: o comprador digita no checkout e a comissao vai pro
-- dono mesmo sem cookie. (Benchmark: a propria fornecedora da Sympla recomenda
-- o codigo como salvaguarda justamente por isso.)
ALTER TABLE "promoter_links" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "promoter_links_code_key" ON "promoter_links"("code");
