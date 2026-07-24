import { z } from "zod";

export const createOrderSchema = z.object({
  reservationId: z.string().uuid(),
  contactEmail: z.string().email(),
  contactName: z.string().min(2).optional(),
  /** celular com DDD — habilita entrega do ingresso por WhatsApp */
  contactPhone: z.string().min(10).max(20).optional(),
  couponCode: z.string().min(3).max(24).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** PDV (venda presencial/manual pelo produtor) — painel > Vendas > PDV, sem checkout. */
export const pdvOrderSchema = z.object({
  ticketLotId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  buyerName: z.string().min(2),
  buyerDocument: z.string().min(5).max(20).optional(),
  buyerEmail: z.string().email().optional(),
});
export type PdvOrderInput = z.infer<typeof pdvOrderSchema>;
