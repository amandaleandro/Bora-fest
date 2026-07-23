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

export interface WhatsAppMessage {
  /** telefone com DDD, só dígitos */
  to: string;
  /** nome do template aprovado no provedor */
  template: string;
  variables: Record<string, string>;
}

export interface WhatsAppSender {
  readonly provider: string;
  send(message: WhatsAppMessage): Promise<void>;
}

export class NotificationSendError extends Error {}
