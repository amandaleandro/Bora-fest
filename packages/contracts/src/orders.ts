import { z } from "zod";

export const createOrderSchema = z.object({
  reservationId: z.string().uuid(),
  contactEmail: z.string().email(),
  contactName: z.string().min(2).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
