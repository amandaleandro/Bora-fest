-- API de Conversões da Meta: token server-side por evento.
-- Fora de pixel_settings de propósito — aquele JSON vai inteiro para a página
-- pública do evento e o token é segredo.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "meta_capi_token" TEXT;
