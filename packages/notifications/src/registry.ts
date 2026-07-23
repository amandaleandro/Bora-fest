import { DevLogEmailSender, DevLogPushSender, DevLogWhatsAppSender, DEVLOG_PROVIDER } from "./dev-log";
import { ExpoPushSender, EXPO_PUSH_PROVIDER } from "./expo-push";
import type { EmailSender, PushSender, WhatsAppSender } from "./types";

const emailSenders = new Map<string, EmailSender>();
const whatsappSenders = new Map<string, WhatsAppSender>();
const pushSenders = new Map<string, PushSender>();

function ensureBuiltins(): void {
  if (!emailSenders.has(DEVLOG_PROVIDER)) {
    emailSenders.set(DEVLOG_PROVIDER, new DevLogEmailSender());
  }
  if (!whatsappSenders.has(DEVLOG_PROVIDER)) {
    whatsappSenders.set(DEVLOG_PROVIDER, new DevLogWhatsAppSender());
  }
  if (!pushSenders.has(DEVLOG_PROVIDER)) {
    pushSenders.set(DEVLOG_PROVIDER, new DevLogPushSender());
  }
  if (!pushSenders.has(EXPO_PUSH_PROVIDER)) {
    pushSenders.set(EXPO_PUSH_PROVIDER, new ExpoPushSender());
  }
}

export function registerEmailSender(sender: EmailSender): void {
  emailSenders.set(sender.provider, sender);
}

export function registerWhatsAppSender(sender: WhatsAppSender): void {
  whatsappSenders.set(sender.provider, sender);
}

export function registerPushSender(sender: PushSender): void {
  pushSenders.set(sender.provider, sender);
}

/** Provedores padrão via env (EMAIL_PROVIDER / WHATSAPP_PROVIDER; devlog em dev). */
export function getEmailSender(): EmailSender {
  ensureBuiltins();
  const provider = process.env.EMAIL_PROVIDER ?? DEVLOG_PROVIDER;
  const sender = emailSenders.get(provider);
  if (!sender) throw new Error(`Provedor de e-mail desconhecido: ${provider}`);
  return sender;
}

export function getWhatsAppSender(): WhatsAppSender {
  ensureBuiltins();
  const provider = process.env.WHATSAPP_PROVIDER ?? DEVLOG_PROVIDER;
  const sender = whatsappSenders.get(provider);
  if (!sender) throw new Error(`Provedor de WhatsApp desconhecido: ${provider}`);
  return sender;
}

/** Diferente de e-mail/WhatsApp: default é o Expo Push real, não devlog (§ nota em expo-push.ts). */
export function getPushSender(): PushSender {
  ensureBuiltins();
  const provider = process.env.PUSH_PROVIDER ?? EXPO_PUSH_PROVIDER;
  const sender = pushSenders.get(provider);
  if (!sender) throw new Error(`Provedor de push desconhecido: ${provider}`);
  return sender;
}
