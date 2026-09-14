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

  const greeting = customerName ? `Olá, ${customerName}!` : "Olá!";
  const text = [
    greeting,
    "",
    message,
    ...(ctaUrl && ctaLabel ? ["", `${ctaLabel}: ${ctaUrl}`] : []),
    "",
    `Mensagem enviada por ${houseName} pela BoraFest.`,
  ].join("\n");

  const htmlMessage = escapeHtml(message).replace(/\n/g, "<br />");
  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#111827;line-height:1.6">
  <p>${escapeHtml(greeting)}</p>
  <p>${htmlMessage}</p>
  ${ctaUrl && ctaLabel ? `<p style="margin:28px 0"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#D9128F;color:#fff;font-weight:700;padding:12px 20px;border-radius:12px;text-decoration:none">${escapeHtml(ctaLabel)}</a></p>` : ""}
  <p style="margin-top:28px;color:#6b7280;font-size:12px">Mensagem enviada por ${escapeHtml(houseName)} pela BoraFest.</p>
</div>`.trim();

  return { to: recipient, subject, text, html };
}
