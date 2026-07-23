import { z } from "zod";

export const createOrderSchema = z.object({
  reservationId: z.string().uuid(),
  contactEmail: z.string().email(),
  contactName: z.string().min(2).optional(),
  /** celular com DDD — habilita entrega do ingresso por WhatsApp */
  contactPhone: z.string().min(10).max(20).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
