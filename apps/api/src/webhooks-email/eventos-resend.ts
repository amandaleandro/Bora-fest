/**
 * Eventos de entrega do Resend → estado da notificação (2026-10-12).
 * Funções puras (sem banco) para o serviço e para os testes.
 *
 * Formato do evento (https://resend.com/docs/dashboard/webhooks/event-types):
 * { type: "email.delivered", created_at, data: { email_id, to: [...],
 *   tags: { notification_id }, bounce?: { message, type, subType } } }
 */

/**
 * Gravidade de cada evento acompanhado. O último evento gravado só é trocado
 * por um de peso MAIOR: eventos chegam fora de ordem, e um "entregue" atrasado
 * não pode apagar um "marcado como spam". Abertura e clique não entram (não
 * medimos leitura).
 */
export const PESO_EVENTO: Record<string, number> = {
  "email.sent": 1,
  "email.delivery_delayed": 2,
  "email.delivered": 3,
  "email.bounced": 4,
  "email.failed": 4,
  "email.suppressed": 4,
  "email.complained": 5,
};

/** Eventos que contam como "não chegou / problema" para o suporte. */
export const EVENTOS_DE_PROBLEMA = ["email.bounced", "email.failed", "email.suppressed", "email.complained"];

export interface EventoResend {
  tipo: string;
  /** id do e-mail no Resend (o mesmo que o envio devolveu) */
  emailId: string | null;
  /** quando o evento aconteceu (created_at do evento; agora, se faltar) */
  ocorridoEm: Date;
  destinatarios: string[];
  /** tag notification_id que o worker manda em todo e-mail */
  notificationId: string | null;
  /** motivo da devolução/falha, quando o Resend informa */
  motivo: string | null;
}

export interface PlanoDeEntrega {
  deliveryEvent: string;
  peso: number;
  deliveredAt?: Date;
  bouncedAt?: Date;
  /** texto para o campo error (só em devolução/falha) */
  erro?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function dataDe(valor: unknown): Date | null {
  const t = texto(valor);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Tag notification_id — o Resend devolve as tags como objeto; aceita também a lista [{name, value}]. */
function tagNotificacao(tags: unknown): string | null {
  let valor: unknown = null;
  if (Array.isArray(tags)) {
    const achada = tags.find((t) => t && typeof t === "object" && (t as { name?: unknown }).name === "notification_id");
    valor = achada ? (achada as { value?: unknown }).value : null;
  } else if (tags && typeof tags === "object") {
    valor = (tags as Record<string, unknown>).notification_id;
  }
  const id = texto(valor);
  return id && UUID.test(id) ? id : null;
}

/** Lê o corpo do webhook. null = não é um evento de e-mail reconhecível. */
export function lerEventoResend(corpo: unknown, agora: Date = new Date()): EventoResend | null {
  if (!corpo || typeof corpo !== "object") return null;
  const evento = corpo as Record<string, unknown>;
  const tipo = texto(evento.type);
  const dados = evento.data && typeof evento.data === "object" ? (evento.data as Record<string, unknown>) : null;
  if (!tipo || !dados) return null;

  const to = dados.to;
  const destinatarios = (Array.isArray(to) ? to : [to])
    .map((d) => texto(d))
    .filter((d): d is string => d !== null);

  const bounce = dados.bounce && typeof dados.bounce === "object" ? (dados.bounce as Record<string, unknown>) : null;
  const falha = dados.failed && typeof dados.failed === "object" ? (dados.failed as Record<string, unknown>) : null;
  const motivo = texto(bounce?.message) ?? texto(falha?.reason) ?? null;

  return {
    tipo,
    emailId: texto(dados.email_id),
    ocorridoEm: dataDe(evento.created_at) ?? dataDe(dados.created_at) ?? agora,
    destinatarios,
    notificationId: tagNotificacao(dados.tags),
    motivo: motivo ? motivo.slice(0, 300) : null,
  };
}

/** O que gravar na notificação para este evento. null = evento não acompanhado. */
export function planoDoEvento(evento: EventoResend): PlanoDeEntrega | null {
  const peso = PESO_EVENTO[evento.tipo];
  if (!peso) return null;
  const plano: PlanoDeEntrega = { deliveryEvent: evento.tipo, peso };
  const motivo = evento.motivo ? `: ${evento.motivo}` : "";

  if (evento.tipo === "email.delivered") plano.deliveredAt = evento.ocorridoEm;
  if (evento.tipo === "email.bounced") {
    plano.bouncedAt = evento.ocorridoEm;
    plano.erro = `Devolvido pelo servidor do destinatário${motivo}`;
  }
  if (evento.tipo === "email.failed") plano.erro = `O Resend não conseguiu enviar${motivo}`;
  if (evento.tipo === "email.suppressed") {
    plano.erro = `O Resend não enviou: o endereço já devolveu e-mail ou marcou como spam antes${motivo}`;
  }
  return plano;
}

/** Eventos de peso menor — os únicos que um evento deste peso pode substituir. */
export function eventosAbaixoDe(peso: number): string[] {
  return Object.entries(PESO_EVENTO)
    .filter(([, p]) => p < peso)
    .map(([tipo]) => tipo);
}
