import { z } from "zod";

export const eventVenueSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().min(3).max(200).optional(),
  mapsUrl: z.string().url().max(500).optional(),
  city: z.string().min(2).max(80),
  state: z.string().length(2).transform((v) => v.toUpperCase()),
});
export type EventVenueInput = z.infer<typeof eventVenueSchema>;

export const eventCategorySchema = z.enum(["SHOWS", "FESTAS", "ESPORTES", "TEATRO"]);
export type EventCategoryInput = z.infer<typeof eventCategorySchema>;

export const createEventSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  venueId: z.string().uuid().optional(),
  /** local inline (feedback 2026-08-03): a API cria o Venue e vincula */
  venue: eventVenueSchema.optional(),
  /** categoria de descoberta na home pública — livre = sem categoria */
  category: eventCategorySchema.optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().default("America/Sao_Paulo"),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

/** IDs de pixel de conversão são sempre alfanuméricos (+ "-"/"_") nos provedores suportados; restringir o
 * formato evita que o valor seja usado pra quebrar fora da string JS onde é interpolado no checkout (XSS). */
const pixelId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Use apenas letras, números, - e _");

/** IDs de pixel de conversão do evento — cada campo é opcional e independente. */
export const pixelSettingsSchema = z.object({
  metaPixelId: pixelId.optional(),
  ga4MeasurementId: pixelId.optional(),
  tiktokPixelId: pixelId.optional(),
});
export type PixelSettingsInput = z.infer<typeof pixelSettingsSchema>;

export const updateEventSchema = createEventSchema.partial().extend({
  bannerUrl: z.string().url().optional(),
  /** sala de espera: admite N compradores por vez no checkout deste evento */
  waitingRoomEnabled: z.boolean().optional(),
  waitingRoomConcurrency: z.number().int().min(1).max(100_000).optional(),
  pixelSettings: pixelSettingsSchema.optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
