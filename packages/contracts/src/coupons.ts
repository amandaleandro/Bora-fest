import { z } from "zod";

export const createCouponSchema = z.object({
  code: z.string().min(3).max(24).regex(/^[A-Za-z0-9]+$/, "Só letras e números"),
  discountType: z.enum(["PERCENT", "FIXED"]),
  /** PERCENT: 1–100; FIXED: centavos */
  discountValue: z.number().int().min(1),
  maxRedemptions: z.number().int().min(1).optional(),
  expiresAt: z.coerce.date().optional(),
}).refine((v) => v.discountType !== "PERCENT" || v.discountValue <= 100, {
  message: "Percentual máximo é 100",
});
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const issueComplimentarySchema = z.object({
  ticketLotId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  attendeeName: z.string().min(2),
  attendeeEmail: z.string().email(),
});
export type IssueComplimentaryInput = z.infer<typeof issueComplimentarySchema>;
