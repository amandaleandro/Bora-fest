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
  /** atrações/line-up, um nome por linha — o hotsite monta a seção */
  lineup: z.string().max(2000).optional(),
  /** o que está incluso (open bar, copo…), um item por linha */
  amenities: z.string().max(2000).optional(),
  /** idade mínima em anos; ausente = evento livre */
  minAge: z.number().int().min(0).max(99).optional(),
  venueId: z.string().uuid().optional(),
  /** local inline (feedback 2026-08-03): a API cria o Venue e vincula */
  venue: eventVenueSchema.optional(),
  /** categoria de descoberta na home pública — OBRIGATÓRIA (decisão
   * 2026-08-08): catálogo sem categoria consistente é impossível de
   * arrumar depois; as prateleiras da home dependem disso */
  category: eventCategorySchema,
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
  // null limpa o pixel no servidor — sem isso, apagar no painel não removia
  // e o checkout seguia disparando Purchase (auditoria 2026-08-10)
  metaPixelId: pixelId.nullable().optional(),
  ga4MeasurementId: pixelId.nullable().optional(),
  tiktokPixelId: pixelId.nullable().optional(),
});
export type PixelSettingsInput = z.infer<typeof pixelSettingsSchema>;

export const updateEventSchema = createEventSchema.partial().extend({
  /** null limpa a categoria (a opção "Sem categoria" do painel era no-op) */
  category: eventCategorySchema.nullable().optional(),
  bannerUrl: z.string().url().optional(),
  /** sala de espera: admite N compradores por vez no checkout deste evento */
  waitingRoomEnabled: z.boolean().optional(),
  waitingRoomConcurrency: z.number().int().min(1).max(100_000).optional(),
  pixelSettings: pixelSettingsSchema.optional(),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
