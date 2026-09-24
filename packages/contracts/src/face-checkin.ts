import { z } from "zod";

/**
 * O BoraFest nunca recebe imagem facial crua neste contrato.
 * O SDK/provedor biométrico devolve referências opacas para enrollment/probe.
 */
export const faceEnrollmentSchema = z.object({
  provider: z.string().trim().min(2).max(60),
  providerReference: z.string().trim().min(6).max(500),
  consentVersion: z.string().trim().min(1).max(60),
  consent: z.literal(true),
});
export type FaceEnrollmentInput = z.infer<typeof faceEnrollmentSchema>;

export const faceVerificationSchema = z.object({
  ticketId: z.string().uuid(),
  probeReference: z.string().trim().min(6).max(500),
  checkinPointId: z.string().uuid().optional(),
  scannedAt: z.coerce.date().optional(),
});
export type FaceVerificationInput = z.infer<typeof faceVerificationSchema>;
