import { z } from "zod";

export const createTicketTypeSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  position: z.number().int().min(0).default(0),
});
export type CreateTicketTypeInput = z.infer<typeof createTicketTypeSchema>;

export const createTicketLotSchema = z.object({
  name: z.string().min(2),
  priceCents: z.number().int().min(0),
  feeCents: z.number().int().min(0).default(0),
  capacity: z.number().int().min(1),
  maxPerOrder: z.number().int().min(1).max(20).default(6),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
export type CreateTicketLotInput = z.infer<typeof createTicketLotSchema>;
