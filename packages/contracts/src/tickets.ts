import { z } from "zod";

/**
 * Transferência de ingresso (arquitetura §13) — self-service, sem exigir
 * conta: quem pede prova que é dono do pedido informando o `orderPublicToken`
 * (o mesmo segredo usado pra ver/reenviar os ingressos do pedido).
 */
export const transferTicketSchema = z
  .object({
    // legado: era a prova de posse na era do checkout sem conta. Agora a
    // autorização é a sessão + posse atual do ingresso (auditoria 2026-08-12);
    // mantido opcional só para não quebrar clientes que ainda o enviam.
    orderPublicToken: z.string().uuid().optional(),
    /** caminho NOVO (decisão 2026-08-15): transferência POR CPF da conta destino */
    toCpf: z.string().min(11).max(14).optional(),
    /** legado: por e-mail — mantido para clientes antigos */
    toEmail: z.string().email().optional(),
  })
  .refine((v) => Boolean(v.toCpf) !== Boolean(v.toEmail), {
    message: "Informe o CPF da conta destino (ou o e-mail, no modo antigo)",
  });
export type TransferTicketInput = z.infer<typeof transferTicketSchema>;
