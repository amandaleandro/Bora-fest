-- Convite por e-mail (2026-10-12): 3ª forma do ingresso restrito, no formato
-- da Sympla que o Arthur escolheu (link único, lista manual e convite por
-- e-mail). O lote EMAIL some do site como o LINK; cada convidado recebe um
-- link pessoal e só pega o ingresso com o mesmo e-mail do convite.
-- Só acrescenta: um valor novo no tipo do lote e uma tabela nova. Nenhuma
-- coluna existente muda e nada é apagado.
-- order_id e notification_id não têm chave estrangeira de propósito (o convite
-- só aponta para o pedido que o usou e para o último e-mail mandado).

-- AlterEnum
ALTER TYPE "LotInviteMode" ADD VALUE 'EMAIL';

-- CreateEnum
CREATE TYPE "LotEmailInviteStatus" AS ENUM ('SENT', 'CLAIMED', 'REVOKED');

-- CreateTable
CREATE TABLE "lot_email_invites" (
    "id" UUID NOT NULL,
    "ticket_lot_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "LotEmailInviteStatus" NOT NULL DEFAULT 'SENT',
    "order_id" UUID,
    "notification_id" UUID,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),

    CONSTRAINT "lot_email_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lot_email_invites_token_key" ON "lot_email_invites"("token");

-- CreateIndex
CREATE INDEX "lot_email_invites_order_id_idx" ON "lot_email_invites"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "lot_email_invites_ticket_lot_id_email_key" ON "lot_email_invites"("ticket_lot_id", "email");

-- AddForeignKey
ALTER TABLE "lot_email_invites" ADD CONSTRAINT "lot_email_invites_ticket_lot_id_fkey" FOREIGN KEY ("ticket_lot_id") REFERENCES "ticket_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
