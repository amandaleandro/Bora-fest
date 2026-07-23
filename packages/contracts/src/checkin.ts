import { z } from "zod";

// --- configuração pelo produtor ---------------------------------------------

export const createCheckinPointSchema = z.object({
  name: z.string().min(1).max(60),
});
export type CreateCheckinPointInput = z.infer<typeof createCheckinPointSchema>;

export const createValidatorCredentialSchema = z.object({
  label: z.string().min(2).max(60),
  /** dias de validade do PIN (padrão: até 2 dias após o fim do evento) */
  expiresAt: z.coerce.date().optional(),
});
export type CreateValidatorCredentialInput = z.infer<typeof createValidatorCredentialSchema>;

// --- app de check-in ---------------------------------------------------------

export const validatorSessionSchema = z.object({
  eventId: z.string().uuid(),
  pin: z.string().length(6),
});
export type ValidatorSessionInput = z.infer<typeof validatorSessionSchema>;

export const registerValidatorDeviceSchema = z.object({
  /** identificação do aparelho (ex.: "Moto G da Ana — Portão A") */
  name: z.string().min(2).max(80),
});
export type RegisterValidatorDeviceInput = z.infer<typeof registerValidatorDeviceSchema>;

export const createCheckinSchema = z.object({
  /** QR completo (preferido — o servidor confere a assinatura) ou código curto */
  qrToken: z.string().optional(),
  code: z.string().optional(),
  checkinPointId: z.string().uuid().optional(),
  scannedAt: z.coerce.date().optional(),
}).refine((v) => v.qrToken || v.code, {
  message: "Informe qrToken ou code",
});
export type CreateCheckinInput = z.infer<typeof createCheckinSchema>;

export const syncCheckinsSchema = z.object({
  /** id do lote gerado no aparelho — reenvio devolve o mesmo resultado */
  batchKey: z.string().min(8).max(64),
  items: z
    .array(
      z.object({
        localSeq: z.number().int().min(1),
        ticketId: z.string().uuid(),
        checkinPointId: z.string().uuid().optional(),
        scannedAt: z.coerce.date(),
      }),
    )
    .min(1)
    .max(500),
});
export type SyncCheckinsInput = z.infer<typeof syncCheckinsSchema>;
