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
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;
