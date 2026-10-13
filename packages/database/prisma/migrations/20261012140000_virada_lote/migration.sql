-- Virada automática de lote (2026-10-12): o 2º lote pode nascer guardado
-- (DRAFT) e abrir sozinho quando o 1º esgotar ou for encerrado.
-- Só adiciona uma coluna opcional: nenhum dado existente muda.

-- AlterTable
ALTER TABLE "ticket_lots" ADD COLUMN "activate_after_lot_id" UUID;

-- CreateIndex
CREATE INDEX "ticket_lots_activate_after_lot_id_idx" ON "ticket_lots"("activate_after_lot_id");

-- AddForeignKey
-- SET NULL: apagar o lote anterior nunca apaga o seguinte (o servidor já recusa
-- apagar lote que tem outro esperando por ele; isto é só a rede de segurança)
ALTER TABLE "ticket_lots" ADD CONSTRAINT "ticket_lots_activate_after_lot_id_fkey" FOREIGN KEY ("activate_after_lot_id") REFERENCES "ticket_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
