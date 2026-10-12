import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) só com o crypto do Node — sem dependência nova (2026-10-12).
 * HMAC-SHA1, passo de 30 s e 6 dígitos: o padrão que Google Authenticator,
 * Microsoft Authenticator, Authy e 1Password leem do link otpauth://.
 */
export const TOTP_PASSO_SEGUNDOS = 30;
export const TOTP_DIGITOS = 6;
/** tolerância de relógio do celular: aceita o passo anterior e o seguinte (±30 s) */
export const TOTP_JANELA = 1;
/** 160 bits, o tamanho que a RFC 4226 recomenda para HMAC-SHA1 */
export const TOTP_BYTES_SEGREDO = 20;

const ALFABETO_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 da RFC 4648 sem "=" no fim — é o formato que os apps autenticadores pedem. */
export function base32Encode(dados: Buffer): string {
  let bits = 0;
  let valor = 0;
  let saida = "";
  for (const byte of dados) {
    // só os bits ainda não consumidos importam: a máscara evita estouro de 32 bits
    valor = ((valor << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return saida;
}

/** Aceita minúsculas, espaços, hífens e "=" (como as pessoas copiam a chave). */
export function base32Decode(texto: string): Buffer {
  const limpo = texto.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const letra of limpo) {
    const indice = ALFABETO_BASE32.indexOf(letra);
    if (indice === -1) throw new Error("Chave base32 inválida");
    valor = ((valor << 5) | indice) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function gerarSegredoTotp(): Buffer {
  return randomBytes(TOTP_BYTES_SEGREDO);
}

/** HOTP (RFC 4226): HMAC-SHA1 do contador de 8 bytes + truncamento dinâmico. */
export function hotp(segredo: Buffer, contador: number, digitos = TOTP_DIGITOS): string {
  const mensagem = Buffer.alloc(8);
  mensagem.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac("sha1", segredo).update(mensagem).digest();
  const deslocamento = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[deslocamento] & 0x7f) << 24) |
    (hmac[deslocamento + 1] << 16) |
    (hmac[deslocamento + 2] << 8) |
    hmac[deslocamento + 3];
  return String(binario % 10 ** digitos).padStart(digitos, "0");
}

/** passo TOTP de um instante (ms desde 1970) */
export function passoTotp(instanteMs: number): number {
  return Math.floor(instanteMs / 1000 / TOTP_PASSO_SEGUNDOS);
}

export function codigoTotp(segredo: Buffer, instanteMs = Date.now(), digitos = TOTP_DIGITOS): string {
  return hotp(segredo, passoTotp(instanteMs), digitos);
}

/**
 * Confere um código de 6 dígitos contra o passo atual ±janela. Devolve o PASSO
 * que bateu (serve para barrar o reuso do mesmo código) ou null. Compara todos
 * os passos da janela, sem sair no primeiro acerto, com comparação de tempo
 * constante.
 */
export function verificarTotp(
  segredo: Buffer,
  codigo: string,
  agoraMs = Date.now(),
  janela = TOTP_JANELA,
): number | null {
  const limpo = String(codigo ?? "").replace(/\s/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITOS}}$`).test(limpo)) return null;
  const digitado = Buffer.from(limpo);
  const atual = passoTotp(agoraMs);
  let achado: number | null = null;
  for (let delta = -janela; delta <= janela; delta++) {
    const passo = atual + delta;
    if (passo < 0) continue;
    const esperado = Buffer.from(hotp(segredo, passo));
    if (timingSafeEqual(esperado, digitado) && achado === null) achado = passo;
  }
  return achado;
}

/**
 * Link otpauth:// (formato "Key Uri" do Google Authenticator). Montado à mão:
 * URLSearchParams troca espaço por "+", e alguns apps mostram o "+" literal.
 */
export function linkOtpauth(opcoes: { emissor: string; conta: string; segredoBase32: string }): string {
  const emissor = encodeURIComponent(opcoes.emissor);
  const rotulo = `${emissor}:${encodeURIComponent(opcoes.conta)}`;
  return (
    `otpauth://totp/${rotulo}?secret=${opcoes.segredoBase32}&issuer=${emissor}` +
    `&algorithm=SHA1&digits=${TOTP_DIGITOS}&period=${TOTP_PASSO_SEGUNDOS}`
  );
}
