/**
 * Envio de mensagens (arquitetura §3: E-mail / WhatsApp / Push abstraídos
 * pelo backend). Mesmo padrão dos gateways de pagamento: interface + adapters
 * escolhidos por env — trocar de provedor não toca o domínio.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  readonly provider: string;
  send(message: EmailMessage): Promise<void>;
}

export interface WhatsAppTemplateMessage {
  /** telefone com DDD, só dígitos */
  to: string;
  /** nome do template aprovado no provedor */
  template: string;
  variables: Record<string, string>;
}

/** Texto livre — vale na janela de 24h aberta pelo próprio comprador. */
export interface WhatsAppTextMessage {
  to: string;
  text: string;
}

/** Imagem por URL pública (ex.: QR do ingresso) com legenda opcional. */
export interface WhatsAppImageMessage {
  to: string;
  imageUrl: string;
  caption?: string;
}

export type WhatsAppMessage = WhatsAppTemplateMessage | WhatsAppTextMessage | WhatsAppImageMessage;

export interface WhatsAppSender {
  readonly provider: string;
  send(message: WhatsAppMessage): Promise<void>;
}

export interface PushMessage {
  /** Expo push token (`ExponentPushToken[...]`) — é o que fica em `Notification.recipient` */
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSender {
  readonly provider: string;
  send(message: PushMessage): Promise<void>;
}

export class NotificationSendError extends Error {}
