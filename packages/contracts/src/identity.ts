import { z } from "zod";

export const requestOtpSchema = z.object({
  destination: z.string().min(3),
  channel: z.enum(["EMAIL", "SMS", "WHATSAPP"]),
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  destination: z.string().min(3),
  code: z.string().length(6),
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
