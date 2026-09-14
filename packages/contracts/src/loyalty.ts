import { z } from "zod";

export const updateLoyaltyProgramSchema = z.object({
  enabled: z.boolean(),
  pointsPerReal: z.number().int().min(0).max(100),
  silverPoints: z.number().int().min(0).max(10_000_000),
  goldPoints: z.number().int().min(0).max(10_000_000),
  platinumPoints: z.number().int().min(0).max(10_000_000),
}).superRefine((value, ctx) => {
  if (value.goldPoints < value.silverPoints) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["goldPoints"], message: "O nível Ouro deve começar depois do Prata" });
  }
  if (value.platinumPoints < value.goldPoints) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["platinumPoints"], message: "O nível Platina deve começar depois do Ouro" });
  }
});

export type UpdateLoyaltyProgramInput = z.infer<typeof updateLoyaltyProgramSchema>;

export const createLoyaltyRewardSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  pointsCost: z.number().int().min(1).max(10_000_000),
  quantity: z.number().int().min(1).max(1_000_000).nullable().optional(),
  maxPerCustomer: z.number().int().min(1).max(50).default(1),
});
export type CreateLoyaltyRewardInput = z.infer<typeof createLoyaltyRewardSchema>;

export const updateLoyaltyRewardSchema = createLoyaltyRewardSchema.partial().extend({
  active: z.boolean().optional(),
});
export type UpdateLoyaltyRewardInput = z.infer<typeof updateLoyaltyRewardSchema>;

export const useLoyaltyRedemptionSchema = z.object({
  code: z.string().trim().min(6).max(64),
});
export type UseLoyaltyRedemptionInput = z.infer<typeof useLoyaltyRedemptionSchema>;
