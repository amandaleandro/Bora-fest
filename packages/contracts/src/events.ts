import { z } from "zod";

const BRAZIL_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
]);

export const eventVenueSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(3).max(200).optional(),
  mapsUrl: z.string().url().max(500).optional(),
  city: z.string().trim().min(2).max(80),
  state: z
    .string()
    .trim()
    .length(2)
    .transform((v) => v.toUpperCase())
    .refine((v) => BRAZIL_STATES.has(v), "UF inválida"),
});
export type EventVenueInput = z.infer<typeof eventVenueSchema>;

export const eventCategorySchema = z.enum(["SHOWS", "FESTAS", "ESPORTES", "TEATRO"]);
export type EventCategoryInput = z.infer<typeof eventCategorySchema>;

const eventCoreSchema = z.object({
  title: z.string().trim().min(3),
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

export const createEventSchema = eventCoreSchema.superRefine((event, ctx) => {
  if (new Date(event.endsAt).getTime() <= new Date(event.startsAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "O término do evento precisa ser depois do início",
    });
  }
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

export const ticketThemeSchema = z.object({
  template: z.enum(["CLASSIC", "DARK", "FESTA", "PREMIUM"]).default("CLASSIC"),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#6D28D9"),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#111827"),
  backgroundImageUrl: z.string().url().max(500).nullable().optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  sponsorText: z.string().trim().max(120).nullable().optional(),
  showVenue: z.boolean().default(true),
  showLot: z.boolean().default(true),
  showAttendee: z.boolean().default(true),
});
export type TicketThemeInput = z.infer<typeof ticketThemeSchema>;

export const updateEventSchema = eventCoreSchema.partial().extend({
  /** null limpa a categoria (a opção "Sem categoria" do painel era no-op) */
  category: eventCategorySchema.nullable().optional(),
  bannerUrl: z.string().url().optional(),
  /** sala de espera: admite N compradores por vez no checkout deste evento */
  waitingRoomEnabled: z.boolean().optional(),
  waitingRoomConcurrency: z.number().int().min(1).max(100_000).optional(),
  pixelSettings: pixelSettingsSchema.optional(),
  /** Token da API de Conversões da Meta; "" ou null desliga o envio server-side. */
  // 2000: token de system user da Meta pode passar de 500 quando vem com
  // escopos extras (Dataset Quality API) — o limite curto barrava o salvamento
  metaCapiToken: z.string().trim().max(2000).nullable().optional(),
  /** personalização visual do ingresso; não altera QR/código/validade */
  ticketTheme: ticketThemeSchema.nullable().optional(),
}).superRefine((event, ctx) => {
  if (event.startsAt && event.endsAt && new Date(event.endsAt).getTime() <= new Date(event.startsAt).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endsAt"],
      message: "O término do evento precisa ser depois do início",
    });
  }
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** Cancelar o evento: o motivo vai no aviso ao comprador, então é obrigatório. */
export const cancelEventSchema = z.object({
  reason: z.string().trim().min(3, "Diga o motivo do cancelamento").max(300),
  batchSize: z.number().int().min(1).max(25).optional(),
  /** pedidos que já falharam nesta sessão — pular para a fila não travar neles */
  skipOrderIds: z.array(z.string().uuid()).max(500).optional(),
});
export type CancelEventInput = z.infer<typeof cancelEventSchema>;
