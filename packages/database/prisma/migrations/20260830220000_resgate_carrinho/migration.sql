-- Resgate de carrinho pós-expiração (decisão do Arthur 2026-08-30): 1h depois
-- do pedido expirar, um e-mail convida a recomeçar pelo hotsite do evento.
-- Marca por pedido para nunca repetir.
ALTER TABLE "orders" ADD COLUMN "rescue_reminder_sent_at" TIMESTAMP(3);
