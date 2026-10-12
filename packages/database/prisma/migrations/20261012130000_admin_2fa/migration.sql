-- Segundo fator (TOTP) no backoffice (2026-10-12).
-- Aprovar saque, estornar, marcar repasse pago, mudar taxa e aprovar casa
-- pediam só a sessão (código no e-mail): quem invadisse o e-mail de um admin
-- liberava dinheiro. Agora essas ações pedem o código do app autenticador.
-- totp_secret guarda o segredo CIFRADO (AES-256-GCM com TOTP_ENCRYPTION_KEY);
-- totp_enabled_at marca quando o staff confirmou o 1º código.
-- Só acrescenta: nenhuma coluna existente muda e nada é apagado.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "totp_secret" TEXT,
ADD COLUMN "totp_enabled_at" TIMESTAMP(3);
