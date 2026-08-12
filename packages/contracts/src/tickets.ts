import { z } from "zod";

/**
 * Transferência de ingresso (arquitetura §13) — self-service, sem exigir
 * conta: quem pede prova que é dono do pedido informando o `orderPublicToken`
 * (o mesmo segredo usado pra ver/reenviar os ingressos do pedido).
 */
export const transferTicketSchema = z.object({
  // legado: era a prova de posse na era do checkout sem conta. Agora a
  // autorização é a sessão + posse atual do ingresso (auditoria 2026-08-12);
  // mantido opcional só para não quebrar clientes que ainda o enviam.
  orderPublicToken: z.string().uuid().optional(),
  toEmail: z.string().email(),
});
export type TransferTicketInput = z.infer<typeof transferTicketSchema>;
