import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Assinatura do webhook do Resend (2026-10-12). O Resend entrega os eventos
 * pelo Svix: cabeçalhos svix-id, svix-timestamp e svix-signature, e o corpo
 * assinado é `${id}.${timestamp}.${corpo cru}` com HMAC-SHA256. O segredo
 * ("whsec_<base64>") vem de RESEND_WEBHOOK_SECRET. Feito com o crypto do Node,
 * sem a biblioteca do Svix (nenhuma dependência nova).
 *
 * Sem esta conferência qualquer um poderia marcar um e-mail como "entregue"
 * e o suporte confiaria numa informação falsa.
 */

/** Janela do Svix: evento com horário fora de ±5 min é recusado (reenvio velho/replay). */
export const TOLERANCIA_SEGUNDOS = 5 * 60;

export type ResultadoAssinatura = { ok: true } | { ok: false; motivo: string };

export interface CabecalhosSvix {
  id?: string;
  timestamp?: string;
  assinaturas?: string;
}

/** Lê os cabeçalhos svix-* (ou webhook-*, o nome do padrão Standard Webhooks). */
export function lerCabecalhosSvix(headers: Record<string, string | string[] | undefined>): CabecalhosSvix {
  const um = (nome: string): string | undefined => {
    const valor = headers[nome] ?? headers[nome.toLowerCase()];
    return Array.isArray(valor) ? valor[0] : valor;
  };
  return {
    id: um("svix-id") ?? um("webhook-id"),
    timestamp: um("svix-timestamp") ?? um("webhook-timestamp"),
    assinaturas: um("svix-signature") ?? um("webhook-signature"),
  };
}

/** Chave HMAC do segredo "whsec_<base64>" (o prefixo é opcional). */
export function chaveDoSegredo(segredo: string): Buffer | null {
  const limpo = segredo.trim();
  const base = limpo.startsWith("whsec_") ? limpo.slice("whsec_".length) : limpo;
  if (!base || !/^[A-Za-z0-9+/]+={0,2}$/.test(base)) return null;
  const chave = Buffer.from(base, "base64");
  return chave.length > 0 ? chave : null;
}

/** Assinatura v1 esperada, em base64 — exportada para os testes montarem eventos válidos. */
export function assinarSvix(segredo: string, id: string, timestamp: string, corpo: string | Buffer): string {
  const chave = chaveDoSegredo(segredo);
  if (!chave) throw new Error("Segredo do webhook inválido");
  return createHmac("sha256", chave)
    .update(Buffer.concat([Buffer.from(`${id}.${timestamp}.`, "utf8"), Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo, "utf8")]))
    .digest("base64");
}

export function verificarAssinaturaSvix(input: {
  segredo: string;
  cabecalhos: CabecalhosSvix;
  corpo: string | Buffer;
  agora?: Date;
}): ResultadoAssinatura {
  const { id, timestamp, assinaturas } = input.cabecalhos;
  if (!id || !timestamp || !assinaturas) return { ok: false, motivo: "cabeçalhos svix ausentes" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, motivo: "horário do evento inválido" };

  const agoraSegundos = Math.floor((input.agora ?? new Date()).getTime() / 1000);
  if (Math.abs(agoraSegundos - Number(timestamp)) > TOLERANCIA_SEGUNDOS) {
    return { ok: false, motivo: "horário do evento fora da janela de 5 minutos" };
  }

  if (!chaveDoSegredo(input.segredo)) return { ok: false, motivo: "RESEND_WEBHOOK_SECRET em formato inválido" };
  const esperada = Buffer.from(assinarSvix(input.segredo, id, timestamp, input.corpo), "base64");

  // o cabeçalho pode trazer várias assinaturas ("v1,<b64> v1,<b64>") durante a
  // troca do segredo; basta uma conferir
  for (const parte of assinaturas.split(" ")) {
    const virgula = parte.indexOf(",");
    if (virgula < 0) continue;
    const versao = parte.slice(0, virgula);
    const valor = parte.slice(virgula + 1);
    if (versao !== "v1" || !valor) continue;
    const recebida = Buffer.from(valor, "base64");
    if (recebida.length === esperada.length && timingSafeEqual(recebida, esperada)) return { ok: true };
  }
  return { ok: false, motivo: "assinatura não confere" };
}
