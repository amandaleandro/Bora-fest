import { z } from "zod";

export const createReservationSchema = z.object({
  eventId: z.string().uuid(),
  items: z
    .array(
      z.object({
        ticketLotId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
        /** meia-entrada (Lei 12.933/2013): preço/2, taxa de serviço cheia */
        halfPrice: z.boolean().optional(),
      }),
    )
    .min(1),
  /** obtido em POST /v1/public/events/:slug/waiting-room/join — exigido quando o evento tem sala de espera ativa */
  waitingRoomTicketId: z.string().uuid().optional(),
  /** link do promoter (?pr=): exigido para reservar lote exclusivo do promoter */
  promoterSlug: z.string().trim().min(1).max(80).optional(),
  /** código do link de convidado (?convite=): exigido para reservar lote restrito por link */
  // sem mínimo de tamanho: convite cortado/errado não pode barrar a reserva de lote
  // aberto — quem confere o código é o serviço, só nos lotes por link (2026-10-11)
  inviteToken: z.string().trim().max(80).optional(),
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;
