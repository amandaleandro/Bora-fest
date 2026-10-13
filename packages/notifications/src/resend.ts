import { withContext } from "@borafest/observability";
import { NotificationSendError, type EmailMessage, type EmailSendResult, type EmailSender } from "./types";

const log = withContext({ module: "notifications-resend" });

export const RESEND_PROVIDER = "resend";

// O Resend recusa (422) a mensagem inteira com tag fora deste formato — uma
// tag ruim nunca pode custar o e-mail, então ela é descartada (2026-10-12).
const TAG_VALIDA = /^[A-Za-z0-9_-]{1,256}$/;

/** Tags no formato da API do Resend, só as válidas. */
export function resendTags(tags: Record<string, string> | undefined): { name: string; value: string }[] {
  if (!tags) return [];
  return Object.entries(tags)
    .filter(([name, value]) => TAG_VALIDA.test(name) && typeof value === "string" && TAG_VALIDA.test(value))
    .map(([name, value]) => ({ name, value }));
}

// Cabeçalhos extras (LGPD, 2026-10-12): nome só com letras, números e hífen;
// valor numa linha só (quebra de linha num cabeçalho injeta outro cabeçalho) e
// bem abaixo do limite de 998 caracteres por linha do e-mail. Os que o próprio
// envio já define (remetente, destino, assunto...) nunca são sobrescritos.
const NOME_DE_CABECALHO = /^[A-Za-z0-9-]{1,100}$/;
const CABECALHOS_DO_ENVIO = new Set(["from", "to", "cc", "bcc", "reply-to", "subject", "sender", "date", "message-id"]);

/** Cabeçalhos no formato da API do Resend, só os válidos. */
export function resendHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const validos: Record<string, string> = {};
  if (!headers) return validos;
  for (const [name, value] of Object.entries(headers)) {
    if (!NOME_DE_CABECALHO.test(name) || CABECALHOS_DO_ENVIO.has(name.toLowerCase())) continue;
    if (typeof value !== "string" || !value || value.length > 900 || /[\r\n]/.test(value)) continue;
    validos[name] = value;
  }
  return validos;
}

/**
 * Adapter real de e-mail (Resend — https://resend.com/docs/api-reference).
 * Escolhido por ser o de menor atrito para começar: sem SDK, só um POST com
 * Bearer. Trocar por SES/Postmark é escrever outro adapter com esta interface.
 *
 * Env: RESEND_API_KEY (obrigatório) e EMAIL_FROM (ex.: "BoraFest <ingressos@borafest.com.br>").
 * Ative com EMAIL_PROVIDER=resend.
 */
export class ResendEmailSender implements EmailSender {
  readonly provider = RESEND_PROVIDER;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new NotificationSendError(
        "RESEND_API_KEY e EMAIL_FROM são obrigatórios com EMAIL_PROVIDER=resend",
      );
    }

    const tags = resendTags(message.tags);
    const headers = resendHeaders(message.headers);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(tags.length > 0 ? { tags } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // erro joga para o worker, que reagenda com backoff e conta a tentativa
      throw new NotificationSendError(`Resend respondeu ${response.status}: ${body.slice(0, 200)}`);
    }

    // ENTREGA REAL (2026-10-12): o id devolvido é a chave dos eventos do
    // webhook (entregue/devolvido/reclamação). Resposta sem id NÃO vira erro:
    // o e-mail já foi aceito, e lançar faria o worker mandar de novo.
    const aceito = (await response.json().catch(() => null)) as { id?: unknown } | null;
    const providerMessageId = typeof aceito?.id === "string" && aceito.id ? aceito.id : undefined;

    log.info({ to: message.to, subject: message.subject, providerMessageId }, "e-mail enviado pelo Resend");
    return { providerMessageId };
  }
}
