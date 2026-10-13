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
  /**
   * Marcas que o provedor devolve nos eventos de entrega (2026-10-12): o worker
   * manda o id da notificação, para o webhook achar a linha mesmo se o evento
   * chegar antes de o id do provedor ser gravado. Só letras, números, _ e -.
   */
  tags?: Record<string, string>;
  /**
   * Cabeçalhos extras do e-mail (LGPD, 2026-10-12): hoje só o List-Unsubscribe
   * e o List-Unsubscribe-Post dos e-mails de campanha e do aviso aos
   * seguidores — o "Cancelar inscrição" do Gmail/Apple Mail. Cabeçalho com
   * nome ou valor fora do formato é descartado no envio, nunca o e-mail.
   */
  headers?: Record<string, string>;
}

/**
 * O que o provedor devolve ao aceitar o e-mail (2026-10-12). O id liga os
 * eventos do webhook (entregue/devolvido/reclamação) à notificação.
 */
export interface EmailSendResult {
  providerMessageId?: string;
}

export interface EmailSender {
  readonly provider: string;
  /** void = provedor sem id de mensagem (devlog, capturas de teste) */
  send(message: EmailMessage): Promise<EmailSendResult | void>;
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
