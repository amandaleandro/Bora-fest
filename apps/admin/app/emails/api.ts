import { API_BASE_URL } from "@/lib/config";
import { ApiError, SESSION_EXPIRED_MESSAGE, avisarSessaoVencida } from "@/lib/api";

/**
 * Chamadas das telas E-mails e Configuração (2026-10-12). Mesma regra do
 * lib/api.ts: 401 com token derruba a sessão e manda ao login com aviso.
 * Sem corpo não vai Content-Type (o Fastify recusa JSON declarado e vazio).
 */
export async function pedirApi<T>(path: string, token: string, method: "GET" | "POST" = "GET"): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // resposta que não é JSON (ex.: página de erro do proxy) vira a mensagem genérica
    data = undefined;
  }

  if (!response.ok) {
    if (avisarSessaoVencida(response.status, token)) {
      throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
    }
    const bruta = (data as { message?: unknown } | undefined)?.message;
    const mensagem = Array.isArray(bruta) ? bruta.join("; ") : bruta;
    throw new ApiError(response.status, typeof mensagem === "string" && mensagem ? mensagem : "Erro ao falar com a API");
  }
  return data as T;
}

/** Linha de GET /v1/admin/notifications (FAILED ou PENDING presa há mais de 15 min). */
export interface NotificacaoComProblema {
  id: string;
  channel: "EMAIL" | "WHATSAPP" | "PUSH";
  template: string;
  recipient: string;
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  error: string | null;
  availableAt: string;
  sentAt: string | null;
  createdAt: string;
  orderId: string | null;
}

/** Linha de GET /v1/admin/emails, com o estado real de entrega. */
export interface EmailComEntrega {
  id: string;
  template: string;
  recipient: string;
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  orderId: string | null;
  providerMessageId: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  deliveryEvent: string | null;
}

export interface ConsultaDeEmails {
  itens: EmailComEntrega[];
  provedorEmail: string;
  webhookConfigurado: boolean;
  ultimoRetornoEm: string | null;
}

export const emailsApi = {
  comProblema: (token: string) => pedirApi<NotificacaoComProblema[]>("/v1/admin/notifications", token),
  reenviar: (token: string, id: string) =>
    pedirApi<{ requeued: boolean }>(`/v1/admin/notifications/${encodeURIComponent(id)}/requeue`, token, "POST"),
  consultar: (token: string, filtros: { destinatario?: string; soProblemas?: boolean }) => {
    const query = new URLSearchParams();
    if (filtros.destinatario) query.set("destinatario", filtros.destinatario);
    if (filtros.soProblemas) query.set("situacao", "problemas");
    const qs = query.toString();
    return pedirApi<ConsultaDeEmails>(`/v1/admin/emails${qs ? `?${qs}` : ""}`, token);
  },
};

const NOME_DO_MODELO: Record<string, string> = {
  ticket_delivery: "Ingressos da compra",
  account_claim: "Link de acesso à conta",
  otp_code: "Código de entrada",
  password_reset: "Troca de senha",
  ticket_transferred: "Ingresso transferido",
  free_ticket_canceled: "Ingresso grátis cancelado",
  free_event_canceled: "Evento grátis cancelado",
  crm_reactivation: "Campanha (CRM)",
  promoter_invited: "Convite de promoter",
  member_invited: "Convite para a equipe",
  cpf_defined: "CPF definido na conta",
};

export function nomeDoModelo(template: string): string {
  return NOME_DO_MODELO[template] ?? template;
}

const CANAL: Record<string, string> = { EMAIL: "E-mail", WHATSAPP: "WhatsApp", PUSH: "Push" };

export function nomeDoCanal(channel: string): string {
  return CANAL[channel] ?? channel;
}

export function dataHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export type Tom = "ok" | "alerta" | "erro" | "neutro";

/** Situação do e-mail em português, do pior para o melhor sinal. */
export function situacaoDeEntrega(e: EmailComEntrega): { texto: string; tom: Tom } {
  if (e.status === "FAILED") return { texto: "Falhou no envio", tom: "erro" };
  if (e.status === "PENDING") return { texto: "Na fila de envio", tom: "alerta" };
  if (e.deliveryEvent === "email.complained") {
    return { texto: "Entregue, mas marcado como spam pelo destinatário", tom: "erro" };
  }
  if (e.bouncedAt || e.deliveryEvent === "email.bounced") return { texto: "Devolvido (não chegou)", tom: "erro" };
  if (e.deliveryEvent === "email.failed") return { texto: "O Resend não conseguiu enviar", tom: "erro" };
  if (e.deliveryEvent === "email.suppressed") {
    return { texto: "Bloqueado: o endereço já devolveu e-mail antes", tom: "erro" };
  }
  if (e.deliveredAt) return { texto: `Entregue em ${dataHora(e.deliveredAt)}`, tom: "ok" };
  if (e.deliveryEvent === "email.delivery_delayed") return { texto: "Entrega atrasada (o Resend segue tentando)", tom: "alerta" };
  if (!e.providerMessageId) return { texto: "Enviado, sem rastreio de entrega", tom: "neutro" };
  return { texto: "Aceito pelo Resend, sem retorno de entrega ainda", tom: "neutro" };
}

export const COR_DO_TOM: Record<Tom, string> = {
  ok: "text-emerald-400",
  alerta: "text-amber-300",
  erro: "text-rose-400",
  neutro: "text-slate-400",
};
