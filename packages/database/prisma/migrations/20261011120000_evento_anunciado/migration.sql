-- Anúncio do evento aos seguidores da Casa, uma vez só (2026-10-11).
-- Evento privado que vira público precisa avisar quem segue a Casa, mas nunca
-- duas vezes. A marca guarda quando o aviso saiu; vazia = ainda não anunciado.
-- Só acrescenta: nenhuma coluna existente muda e nada é apagado.

-- AlterTable
ALTER TABLE "events" ADD COLUMN "followers_notified_at" TIMESTAMP(3);

-- Backfill: todo evento que já saiu do rascunho como público conta como
-- anunciado (recebeu o aviso na publicação, ou é antigo demais para isso).
-- Sem isto, um evento antigo que fosse a privado e voltasse a público seria
-- anunciado de novo. Evento sem published_at (criado direto no banco) usa a
-- última atualização como data.
UPDATE "events"
SET "followers_notified_at" = COALESCE("published_at", "updated_at")
WHERE "is_private" = false
  AND ("published_at" IS NOT NULL OR "status" <> 'DRAFT');
