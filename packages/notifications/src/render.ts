import type { EmailMessage, PushMessage } from "./types";

/**
 * Templates de mensagem (puros e testáveis). O link profundo abre a carteira
 * web do pedido sem exigir conta nem aplicativo (arquitetura §3/§17).
 */

export interface TicketDeliveryPayload {
  contactName?: string;
  eventTitle: string;
  eventStartsAt: string;
  orderUrl: string;
  tickets: Array<{ code: string; typeName: string; lotName: string }>;
}

export function renderTicketDeliveryEmail(
  to: string,
  payload: TicketDeliveryPayload,
): EmailMessage {
  const saudacao = payload.contactName ? `Olá, ${payload.contactName}!` : "Olá!";
  const plural = payload.tickets.length > 1;
  const lista = payload.tickets
    .map((t) => `- ${t.code} — ${t.typeName} / ${t.lotName}`)
    .join("\n");
  const listaHtml = payload.tickets
    .map(
      (t) =>
        `<li><strong>${escapeHtml(t.code)}</strong> — ${escapeHtml(t.typeName)} / ${escapeHtml(t.lotName)}</li>`,
    )
    .join("");

  const text = [
    saudacao,
    "",
    `Seu${plural ? "s" : ""} ingresso${plural ? "s" : ""} para ${payload.eventTitle} ${plural ? "estão prontos" : "está pronto"}! 🎉`,
    "",
    `Data do evento: ${payload.eventStartsAt}`,
    "",
    `Acesse e apresente na entrada: ${payload.orderUrl}`,
    "",
    `Código${plural ? "s" : ""}:`,
    lista,
    "",
    "Guarde este e-mail. Você pode reabrir seus ingressos a qualquer momento pelo link acima, sem precisar de conta ou aplicativo.",
    "",
    "Equipe BoraFest",
  ].join("\n");

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
  <h2>${escapeHtml(saudacao)}</h2>
  <p>Seu${plural ? "s" : ""} ingresso${plural ? "s" : ""} para <strong>${escapeHtml(payload.eventTitle)}</strong> ${plural ? "estão prontos" : "está pronto"}! 🎉</p>
  <p><strong>Data do evento:</strong> ${escapeHtml(payload.eventStartsAt)}</p>
  <p style="margin:24px 0">
    <a href="${escapeHtml(payload.orderUrl)}" style="background:#6d28d9;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">Ver meus ingressos</a>
  </p>
  <ul>${listaHtml}</ul>
  <p style="color:#666;font-size:13px">Guarde este e-mail. Você pode reabrir seus ingressos a qualquer momento pelo link acima, sem precisar de conta ou aplicativo.</p>
  <p>Equipe BoraFest</p>
</div>`.trim();

  return {
    to,
    subject: `Seu${plural ? "s" : ""} ingresso${plural ? "s" : ""} — ${payload.eventTitle}`,
    html,
    text,
  };
}

export function renderTicketDeliveryWhatsApp(payload: TicketDeliveryPayload) {
  return {
    template: "ticket_delivery",
    variables: {
      event_title: payload.eventTitle,
      event_date: payload.eventStartsAt,
      order_url: payload.orderUrl,
      ticket_count: String(payload.tickets.length),
    },
  };
}

export function renderTicketDeliveryPush(to: string, payload: TicketDeliveryPayload): PushMessage {
  const plural = payload.tickets.length > 1;
  return {
    to,
    title: "Seus ingressos estão prontos! 🎉",
    body: `${payload.eventTitle} — ${payload.tickets.length} ingresso${plural ? "s" : ""} liberado${plural ? "s" : ""}`,
    data: { orderUrl: payload.orderUrl },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
