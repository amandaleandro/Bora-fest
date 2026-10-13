import type { EmailMessage } from "./types";

export interface CrmReactivationPayload {
  campaignId: string;
  organizationId: string;
  houseName: string;
  customerName?: string | null;
  subject: string;
  message: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  /**
   * Descadastro (LGPD, 2026-10-12): página do site com o botão "Não quero mais
   * receber" (link no rodapé) e o endereço da API que aceita o "Cancelar
   * inscrição" de um clique do Gmail/Apple Mail (cabeçalho List-Unsubscribe).
   * Campanha enfileirada antes disso não tem os dois e sai como antes.
   */
  unsubscribeUrl?: string | null;
  unsubscribeOneClickUrl?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeHttpUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Cabeçalhos do "Cancelar inscrição" dos provedores (LGPD, 2026-10-12):
 * List-Unsubscribe (RFC 2369) aponta para a rota pública da API, e o
 * List-Unsubscribe-Post (RFC 8058) diz que um POST nela já descadastra, sem
 * abrir página. O um-clique só vale com HTTPS — em dev (http://localhost) vai
 * só o List-Unsubscribe. Endereço inválido = sem cabeçalho (o link do rodapé
 * continua no corpo).
 */
export function cabecalhosDeDescadastro(umCliqueUrl?: string | null): Record<string, string> | undefined {
  const url = safeHttpUrl(umCliqueUrl);
  if (!url) return undefined;
  const headers: Record<string, string> = { "List-Unsubscribe": `<${url}>` };
  if (url.startsWith("https://")) headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  return headers;
}

export function renderCrmReactivationEmail(
  recipient: string,
  payload: CrmReactivationPayload,
): EmailMessage {
  const houseName = payload.houseName.trim() || "BoraFest";
  const customerName = payload.customerName?.trim() || null;
  const subject = payload.subject.trim();
  const message = payload.message.trim();
  const ctaUrl = safeHttpUrl(payload.ctaUrl);
  const ctaLabel = ctaUrl && payload.ctaLabel?.trim() ? payload.ctaLabel.trim() : null;
  const unsubscribeUrl = safeHttpUrl(payload.unsubscribeUrl);
  const headers = cabecalhosDeDescadastro(payload.unsubscribeOneClickUrl);

  // só vai ao público de quem comprou com a Casa E aceitou ofertas por e-mail
  const motivo = `Você recebe este e-mail porque comprou com ${houseName} e aceitou receber ofertas.`;

  const greeting = customerName ? `Olá, ${customerName}!` : "Olá!";
  const text = [
    greeting,
    "",
    message,
    ...(ctaUrl && ctaLabel ? ["", `${ctaLabel}: ${ctaUrl}`] : []),
    "",
    `Mensagem enviada por ${houseName} pela BoraFest.`,
    ...(unsubscribeUrl ? [motivo, `Não quero mais receber: ${unsubscribeUrl}`] : []),
  ].join("\n");

  const htmlMessage = escapeHtml(message).replace(/\n/g, "<br />");
  const rodapeDescadastro = unsubscribeUrl
    ? `<br />${escapeHtml(motivo)} <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280;text-decoration:underline">Não quero mais receber</a>`
    : "";
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;line-height:1.6">
  <p>${escapeHtml(greeting)}</p>
  <p>${htmlMessage}</p>
  ${ctaUrl && ctaLabel ? `<p style="margin:28px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#D9128F;color:#fff;font-weight:700;padding:12px 20px;border-radius:12px;text-decoration:none">${escapeHtml(ctaLabel)}</a></p>` : ""}
  <p style="margin-top:28px;color:#6b7280;font-size:12px">Mensagem enviada por ${escapeHtml(houseName)} pela BoraFest.${rodapeDescadastro}</p>
</div>`.trim();

  return { to: recipient, subject, text, html, ...(headers ? { headers } : {}) };
}
