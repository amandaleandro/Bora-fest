import { z } from "zod";

export const eventVenueSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().min(3).max(200),
  city: z.string().min(2).max(80),
  state: z.string().length(2).transform((v) => v.toUpperCase()),
});
export type EventVenueInput = z.infer<typeof eventVenueSchema>;

export const createEventSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  venueId: z.string().uuid().optional(),
  /** local inline (feedback 2026-08-03): a API cria o Venue e vincula */
  venue: eventVenueSchema.optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().default("America/Sao_Paulo"),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = createEventSchema.partial().extend({
  bannerUrl: z.string().url().optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
