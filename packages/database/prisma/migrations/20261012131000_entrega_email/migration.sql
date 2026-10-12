-- Entrega real do e-mail (2026-10-12).
-- "Enviado" (SENT) só quer dizer que o Resend aceitou o e-mail; o suporte
-- ficava cego quando o comprador dizia "não recebi". O worker passa a guardar
-- o id que o Resend devolve, e o webhook do Resend (POST /v1/webhooks/resend)
-- grava entregue, devolvido e reclamação de spam na própria notificação.
-- Só acrescenta: nenhuma coluna existente muda e nada é apagado. Linhas antigas
-- ficam sem id (sem rastreio), o que a tela de E-mails mostra como tal.

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "provider_message_id" TEXT;
ALTER TABLE "notifications" ADD COLUMN "delivered_at" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN "bounced_at" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN "delivery_event" TEXT;

-- o webhook procura a notificação pelo id do Resend a cada evento
CREATE INDEX "notifications_provider_message_id_idx" ON "notifications"("provider_message_id");
