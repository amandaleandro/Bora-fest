import { z } from "zod";

/**
 * Transferência de ingresso (arquitetura §13) — self-service, sem exigir
 * conta: quem pede prova que é dono do pedido informando o `orderPublicToken`
 * (o mesmo segredo usado pra ver/reenviar os ingressos do pedido).
 */
export const transferTicketSchema = z.object({
  orderPublicToken: z.string().uuid(),
  toName: z.string().min(2).max(120),
  toEmail: z.string().email(),
});
export type TransferTicketInput = z.infer<typeof transferTicketSchema>;
