import { z } from "zod";

export const setOrganizationFeeSchema = z.object({
  pixFeeBps: z.number().int().min(0).max(10000).nullable().optional(),
  pixFeeFloorCents: z.number().int().min(0).nullable().optional(),
  cardFeeBps: z.number().int().min(0).max(10000).nullable().optional(),
});
export type SetOrganizationFeeInput = z.infer<typeof setOrganizationFeeSchema>;

export const blockReasonSchema = z.object({
  reason: z.string().min(3),
});
export type BlockReasonInput = z.infer<typeof blockReasonSchema>;

export const refundOrderSchema = z.object({
  amountCents: z.number().int().min(1).optional(),
  reason: z.string().min(3),
});
export type RefundOrderInput = z.infer<typeof refundOrderSchema>;

export const markPayoutPaidSchema = z.object({
  notes: z.string().min(3).optional(),
});
export type MarkPayoutPaidInput = z.infer<typeof markPayoutPaidSchema>;

export const requestPayoutSchema = z.object({
  amountCents: z.number().int().min(100),
});
export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export const updateSettlementSchema = z.object({
  settlementMode: z.enum(["STANDARD", "INSTANT"]).optional(),
  autoPayout: z.boolean().optional(),
  refundHoldDays: z.number().int().min(0).max(90).optional(),
});
export type UpdateSettlementInput = z.infer<typeof updateSettlementSchema>;
