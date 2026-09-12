import { z } from "zod";

export const crmReactivationSegmentSchema = z.enum([
  "ALL",
  "FIRST_TIME",
  "RECURRING",
  "FREQUENT",
  "LAPSED_30",
  "NO_SHOW",
  "FOLLOWER",
  "EMAIL_OPT_IN",
]);
export type CrmReactivationSegment = z.infer<typeof crmReactivationSegmentSchema>;

export const crmAudiencePreviewSchema = z.object({
  segment: crmReactivationSegmentSchema.default("ALL"),
});
export type CrmAudiencePreviewInput = z.infer<typeof crmAudiencePreviewSchema>;

const safePublicUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Use uma URL http ou https");

export const crmReactivationSendSchema = z.object({
  segment: crmReactivationSegmentSchema.default("ALL"),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(2500),
  ctaLabel: z.string().trim().min(2).max(50).optional(),
  ctaUrl: safePublicUrl.optional(),
}).superRefine((value, ctx) => {
  if ((value.ctaLabel && !value.ctaUrl) || (!value.ctaLabel && value.ctaUrl)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [value.ctaLabel ? "ctaUrl" : "ctaLabel"],
      message: "Informe texto e URL do botão juntos",
    });
  }
});
export type CrmReactivationSendInput = z.infer<typeof crmReactivationSendSchema>;
