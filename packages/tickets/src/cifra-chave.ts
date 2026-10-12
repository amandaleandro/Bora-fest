import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

/**
 * CHAVE DO QR CIFRADA EM REPOUSO (2026-10-12).
 *
 * A chave privada Ed25519 de cada evento (event_signing_keys.private_key_pem)
 * ficava em texto puro no banco e ia inteira no backup diário: quem pegasse um
 * dump gerava QR válido de qualquer evento. Agora ela é gravada cifrada com
 * AES-256-GCM, usando uma chave mestra que mora só no ambiente da API e do
 * worker (TICKET_KEY_ENCRYPTION_KEY, 32 bytes em base64) — o dump sozinho não
 * abre mais nada.
 *
 * Formato gravado: `enc:v1:<iv>:<tag>:<dados>` (base64url). O PEM em texto puro
 * antigo continua sendo lido normalmente, então nada quebra antes de o script
 * apps/api/scripts/cifrar-chaves-qr.ts passar pelas chaves que já existem.
 * Sem a variável, tudo segue em texto puro e o boot avisa.
 *
 * TODO lugar que grava ou lê a chave privada passa por aqui:
 * `protegerChavePrivada` para gravar e `abrirChavePrivada` para usar.
 */

export const VARIAVEL_CHAVE_MESTRA = "TICKET_KEY_ENCRYPTION_KEY";

/** Prefixo do formato atual. Qualquer valor começando com `enc:` conta como cifrado. */
export const PREFIXO_CHAVE_CIFRADA = "enc:v1:";
const PREFIXO_CIFRADO_QUALQUER_VERSAO = "enc:";

const ALGORITMO = "aes-256-gcm";
const TAMANHO_CHAVE_MESTRA = 32;
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

/** TICKET_KEY_ENCRYPTION_KEY definida, mas não é uma chave AES-256 em base64. */
export class ChaveMestraInvalidaError extends Error {}

/** Valor gravado não pôde ser decifrado (chave mestra ausente/diferente, ou valor adulterado). */
export class ChavePrivadaIlegivelError extends Error {}

/**
 * Lê a chave mestra do ambiente. `null` = não configurada (modo texto puro).
 * Configurada errada lança — melhor parar no boot do que gravar algo que
 * ninguém consegue abrir depois.
 */
export function lerChaveMestra(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const bruto = env[VARIAVEL_CHAVE_MESTRA]?.trim();
  if (!bruto) return null;
  // Buffer.from(…, "base64") ignora caracteres inválidos em silêncio — por isso
  // a conferência do alfabeto antes (aceita base64 comum e base64url)
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(bruto)) {
    throw new ChaveMestraInvalidaError(
      `${VARIAVEL_CHAVE_MESTRA} não é base64 válido. Gere com: openssl rand -base64 32`,
    );
  }
  const chave = Buffer.from(bruto, "base64");
  if (chave.length !== TAMANHO_CHAVE_MESTRA) {
    throw new ChaveMestraInvalidaError(
      `${VARIAVEL_CHAVE_MESTRA} precisa ter 32 bytes (tem ${chave.length}). Gere com: openssl rand -base64 32`,
    );
  }
  return chave;
}

export interface EstadoDaChaveMestra {
  /** true = chaves novas são gravadas cifradas */
  cifrando: boolean;
  /** texto para o log do boot quando a chave do QR vai ficar em texto puro */
  aviso: string | null;
}

/**
 * Conferência do boot (API e worker). Sem a variável devolve o aviso para o
 * log; com a variável mal formada lança ChaveMestraInvalidaError.
 */
export function conferirChaveMestra(env: NodeJS.ProcessEnv = process.env): EstadoDaChaveMestra {
  if (lerChaveMestra(env)) return { cifrando: true, aviso: null };
  return {
    cifrando: false,
    aviso:
      `${VARIAVEL_CHAVE_MESTRA} não configurada: a chave que assina os QR de cada evento ` +
      "fica em TEXTO PURO no banco (e vai assim para o backup). Gere com " +
      "`openssl rand -base64 32` e defina a MESMA na API e no worker.",
  };
}

export function chavePrivadaEstaCifrada(valorGravado: string): boolean {
  return valorGravado.startsWith(PREFIXO_CIFRADO_QUALQUER_VERSAO);
}

/** Cifra o PEM com a chave mestra. Recusa valor já cifrado (cifrar duas vezes perderia a chave). */
export function cifrarChavePrivada(privateKeyPem: string, chaveMestra: Buffer): string {
  if (chavePrivadaEstaCifrada(privateKeyPem)) {
    throw new Error("A chave privada já está cifrada — não cifre duas vezes");
  }
  if (chaveMestra.length !== TAMANHO_CHAVE_MESTRA) {
    throw new ChaveMestraInvalidaError(`A chave mestra precisa ter ${TAMANHO_CHAVE_MESTRA} bytes`);
  }
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chaveMestra, iv);
  const dados = Buffer.concat([cifra.update(privateKeyPem, "utf8"), cifra.final()]);
  const tag = cifra.getAuthTag();
  return `${PREFIXO_CHAVE_CIFRADA}${iv.toString("base64url")}:${tag.toString("base64url")}:${dados.toString("base64url")}`;
}

/** Decifra um valor `enc:v1:…`. Chave mestra errada ou valor adulterado lança ChavePrivadaIlegivelError. */
export function decifrarChavePrivada(valorGravado: string, chaveMestra: Buffer): string {
  if (!valorGravado.startsWith(PREFIXO_CHAVE_CIFRADA)) {
    throw new ChavePrivadaIlegivelError(
      chavePrivadaEstaCifrada(valorGravado)
        ? "A chave do evento foi cifrada num formato que esta versão não conhece"
        : "A chave do evento não está no formato cifrado",
    );
  }
  const partes = valorGravado.slice(PREFIXO_CHAVE_CIFRADA.length).split(":");
  const [iv, tag, dados] = partes.map((p) => Buffer.from(p, "base64url"));
  if (partes.length !== 3 || iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG || dados.length === 0) {
    throw new ChavePrivadaIlegivelError("A chave cifrada do evento está corrompida (formato inválido)");
  }
  if (chaveMestra.length !== TAMANHO_CHAVE_MESTRA) {
    throw new ChaveMestraInvalidaError(`A chave mestra precisa ter ${TAMANHO_CHAVE_MESTRA} bytes`);
  }
  try {
    const decifra = createDecipheriv(ALGORITMO, chaveMestra, iv);
    decifra.setAuthTag(tag);
    return Buffer.concat([decifra.update(dados), decifra.final()]).toString("utf8");
  } catch {
    throw new ChavePrivadaIlegivelError(
      `Não foi possível decifrar a chave do evento: a ${VARIAVEL_CHAVE_MESTRA} não é a mesma usada para cifrar, ou o valor foi alterado`,
    );
  }
}

/**
 * Para GRAVAR a chave nova de um evento: cifra quando há chave mestra; sem ela
 * devolve o PEM como está (texto puro, com o aviso do boot).
 */
export function protegerChavePrivada(
  privateKeyPem: string,
  chaveMestra: Buffer | null = lerChaveMestra(),
): string {
  if (!chaveMestra) return privateKeyPem;
  return cifrarChavePrivada(privateKeyPem, chaveMestra);
}

/**
 * Para USAR a chave gravada (assinar QR): aceita o texto puro antigo e o
 * formato cifrado. Cifrada sem chave mestra no ambiente lança — assinar com
 * o texto `enc:…` daria erro mais confuso lá na frente.
 */
export function abrirChavePrivada(valorGravado: string, chaveMestra?: Buffer | null): string {
  if (!chavePrivadaEstaCifrada(valorGravado)) return valorGravado; // legado em texto puro
  const chave = chaveMestra === undefined ? lerChaveMestra() : chaveMestra;
  if (!chave) {
    throw new ChavePrivadaIlegivelError(
      `A chave do evento está cifrada, mas ${VARIAVEL_CHAVE_MESTRA} não está configurada neste serviço`,
    );
  }
  return decifrarChavePrivada(valorGravado, chave);
}
