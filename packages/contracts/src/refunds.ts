import { z } from "zod";

/** Pedido de reembolso feito pelo comprador (arquitetura §13) — fica PENDING até revisão. */
export const createRefundRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type CreateRefundRequestInput = z.infer<typeof createRefundRequestSchema>;

/** Rejeição de um pedido de reembolso pelo staff — exige justificativa. */
export const rejectRefundRequestSchema = z.object({
  note: z.string().min(3).max(500),
});
export type RejectRefundRequestInput = z.infer<typeof rejectRefundRequestSchema>;

/**
 * "Cancelar ingresso" do produtor num pedido de R$ 0 (2026-10-11): grátis não se
 * reembolsa, se cancela. O motivo é opcional e fica só na auditoria — não vai
 * para o comprador. Corpo inteiro opcional: o botão pode mandar só o POST.
 */
export const cancelFreeOrderSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .optional();
export type CancelFreeOrderInput = z.infer<typeof cancelFreeOrderSchema>;

/** Aprovação: dispara o estorno de verdade no gateway (mesmo fluxo do admin refund manual). */
export const approveRefundRequestSchema = z.object({
  amountCents: z.number().int().min(1).optional(),
});
export type ApproveRefundRequestInput = z.infer<typeof approveRefundRequestSchema>;
