-- Descadastro (LGPD, 2026-10-12): os e-mails de campanha das Casas e o aviso
-- aos seguidores ganham o link "Não quero mais receber". Quem sai das
-- campanhas de uma Casa fica nesta tabela, e os disparos daquela Casa pulam o
-- e-mail dele. (Deixar de seguir usa a tabela organization_follows, que já
-- existe.)
-- Só acrescenta: uma tabela nova. Nenhuma coluna existente muda e nada é
-- apagado. organization_id não tem chave estrangeira de propósito: o pedido de
-- não receber vale mesmo que a Casa mude ou saia.

-- CreateTable
CREATE TABLE "marketing_opt_outs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_opt_outs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketing_opt_outs_organization_id_email_key_key" ON "marketing_opt_outs"("organization_id", "email_key");
