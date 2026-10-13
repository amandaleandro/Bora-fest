import { parseTicketToken } from "@borafest/tickets";

/**
 * SÓ O QR ATUAL VALE NA PORTA (2026-10-12).
 *
 * A transferência (tickets.service `transferTicket`) reassina o QR com nonce
 * novo e grava o token novo no ingresso. Mas a porta só conferia a ASSINATURA
 * e achava o ingresso pelo id do payload — e o QR antigo continuava assinado
 * pela mesma chave do evento. Resultado: quem vendeu/transferiu o ingresso
 * guardava um print do QR e entrava antes do novo dono.
 *
 * A regra mora aqui, num lugar só, porque a porta lê o QR por DOIS caminhos:
 *  - online (checkins.service): compara a PARTE ASSINADA do QR apresentado com
 *    a do QR gravado no ingresso — tudo tem que ser idêntico (nonce, emissão,
 *    lote);
 *  - offline (validator.service → manifesto): o aparelho não recebe o token
 *    (com ele, qualquer aparelho da portaria geraria o QR de qualquer pessoa),
 *    só o nonce e a hora de emissão do QR atual (`qrAtual`), e compara o nonce
 *    do QR lido antes de aceitar (apps/checkout/lib/portaria/verify.ts).
 */

/** O que o manifesto leva, por ingresso, para a porta offline reconhecer o QR atual. */
export interface QrAtual {
  /** nonce do QR gravado no ingresso */
  n: string;
  /** emissão do QR gravado (epoch em segundos) — diz à porta se a lista local está atrasada */
  iat: number;
}

/** Parte assinada do QR: o payload em base64url, entre o prefixo e a assinatura. */
function parteAssinada(token: string): string | null {
  const partes = token.trim().split(".");
  if (partes.length !== 3 || !partes[1]) return null;
  return partes[1];
}

/**
 * O QR apresentado na porta é o ATUAL do ingresso? Chame SÓ depois de conferir
 * a assinatura (verifyTicketToken) — aqui não se confere assinatura.
 *
 * Compara a parte assinada inteira, e não só o nonce: é estrito por construção
 * e não depende de o QR gravado ter nonce. Espaço ou quebra de linha que o
 * leitor deixe nas pontas não muda a parte assinada, então não vira recusa falsa.
 */
export function ehOQrAtual(qrApresentado: string, qrTokenGravado: string): boolean {
  const apresentado = parteAssinada(qrApresentado);
  return apresentado !== null && apresentado === parteAssinada(qrTokenGravado);
}

/**
 * Nonce + emissão do QR GRAVADO no ingresso, para o manifesto offline.
 * `null` quando o QR gravado não está no formato BF1 ou não tem nonce/emissão
 * (ingresso emitido pelo worker sempre tem): a porta offline não tem o que
 * comparar e segue a regra de antes. O online continua estrito (`ehOQrAtual`).
 */
export function qrAtualDoIngresso(qrTokenGravado: string): QrAtual | null {
  try {
    const payload = parseTicketToken(qrTokenGravado.trim());
    const n: unknown = payload.n;
    const iat: unknown = payload.iat;
    if (typeof n !== "string" || n.length === 0) return null;
    if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
    return { n, iat };
  } catch {
    return null;
  }
}
