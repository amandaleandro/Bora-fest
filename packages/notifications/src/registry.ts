import { DevLogEmailSender, DevLogWhatsAppSender, DEVLOG_PROVIDER } from "./dev-log";
import type { EmailSender, WhatsAppSender } from "./types";

const emailSenders = new Map<string, EmailSender>();
const whatsappSenders = new Map<string, WhatsAppSender>();

function ensureBuiltins(): void {
  if (!emailSenders.has(DEVLOG_PROVIDER)) {
    emailSenders.set(DEVLOG_PROVIDER, new DevLogEmailSender());
  }
  if (!whatsappSenders.has(DEVLOG_PROVIDER)) {
    whatsappSenders.set(DEVLOG_PROVIDER, new DevLogWhatsAppSender());
  }
}

export function registerEmailSender(sender: EmailSender): void {
  emailSenders.set(sender.provider, sender);
}

export function registerWhatsAppSender(sender: WhatsAppSender): void {
  whatsappSenders.set(sender.provider, sender);
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
