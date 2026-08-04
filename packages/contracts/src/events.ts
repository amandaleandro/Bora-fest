import { z } from "zod";

export const createEventSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  venueId: z.string().uuid().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().default("America/Sao_Paulo"),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = createEventSchema.partial().extend({
  bannerUrl: z.string().url().optional(),
  /** sala de espera: admite N compradores por vez no checkout deste evento */
  waitingRoomEnabled: z.boolean().optional(),
  waitingRoomConcurrency: z.number().int().min(1).max(100_000).optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
