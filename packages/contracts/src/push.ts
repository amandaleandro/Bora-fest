import { z } from "zod";

/** Registro de token de push (Expo) — escopo é o pedido, não exige conta. */
export const registerPushTokenSchema = z.object({
  token: z.string().min(10),
  platform: z.enum(["ios", "android"]),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

/** Inscrição Web Push (navegador/PWA) — valida a forma antes de gravar. */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  userAgent: z.string().max(500).optional(),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const removePushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
});
export type RemovePushSubscriptionInput = z.infer<typeof removePushSubscriptionSchema>;
