import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Link "Não quero mais receber" (LGPD, 2026-10-12) dos e-mails de campanha e
 * do aviso aos seguidores.
 *
 * O código do link é ASSINADO com o mesmo segredo da sessão (chave própria
 * derivada dele, com o propósito "descadastro"), no mesmo espírito do
 * createSessionToken com `purpose`: quem não tem o segredo não fabrica nem
 * altera um link, e o código nunca vale como login. Não é um JWT por dois
 * motivos medidos:
 *  - o Fastify recusa (404) parâmetro de rota com mais de 100 caracteres, e um
 *    JWT tem mais de 300 — o /v1/public/descadastro/:token nunca abriria;
 *  - o JWT é só base64: o e-mail da pessoa ficaria legível na URL (histórico
 *    do navegador, logs de proxy). Aqui só vão identificadores.
 *
 * Formato (base64url): [tipo 1 byte][ids 16 ou 32 bytes][assinatura 16 bytes]
 *  - seguidor (66 caracteres): Casa + usuário → deixa de seguir aquela Casa;
 *  - campanha (44 caracteres): id da notificação da campanha → o e-mail e a
 *    Casa saem da própria linha da fila (notifications), que o sistema nunca
 *    apaga.
 * O link não vence: pedir para não receber vale a qualquer tempo.
 */
export const DESCADASTRO_PROPOSITO = "descadastro";

const TIPO_SEGUIDOR = 1;
const TIPO_CAMPANHA = 2;
const TAMANHO_ASSINATURA = 16; // 128 bits
const TAMANHO_SEGUIDOR = 1 + 16 + 16 + TAMANHO_ASSINATURA;
const TAMANHO_CAMPANHA = 1 + 16 + TAMANHO_ASSINATURA;
/** maior código válido (seguidor) tem 66 caracteres; folga sem passar do limite do Fastify */
const TAMANHO_MAXIMO_DO_TEXTO = 90;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PedidoDeDescadastro =
  | { tipo: "seguidor"; organizationId: string; userId: string }
  | { tipo: "campanha"; notificationId: string };

/** Mesma chave de e-mail do CRM: LOWER(TRIM(email)). */
export function chaveDoEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function ehUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

function chaveDaAssinatura(): Buffer {
  const segredo = process.env.SESSION_JWT_SECRET;
  if (!segredo) throw new Error("SESSION_JWT_SECRET is not set");
  // chave própria do descadastro: a assinatura de um link nunca serve para
  // outra coisa, e nada assinado para outra coisa vale como link
  return Buffer.from(hkdfSync("sha256", segredo, "borafest", `${DESCADASTRO_PROPOSITO}:v1`, 32));
}

function assinar(corpo: Buffer): Buffer {
  return createHmac("sha256", chaveDaAssinatura()).update(corpo).digest().subarray(0, TAMANHO_ASSINATURA);
}

function uuidEmBytes(id: string): Buffer {
  if (!ehUuid(id)) throw new Error("Identificador inválido para o link de descadastro");
  return Buffer.from(id.replace(/-/g, ""), "hex");
}

function bytesEmUuid(bytes: Buffer): string {
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Gera o código do link. Lança sem SESSION_JWT_SECRET: e-mail de campanha não sai sem o link de sair. */
export function criarTokenDeDescadastro(pedido: PedidoDeDescadastro): string {
  const corpo =
    pedido.tipo === "seguidor"
      ? Buffer.concat([Buffer.from([TIPO_SEGUIDOR]), uuidEmBytes(pedido.organizationId), uuidEmBytes(pedido.userId)])
      : Buffer.concat([Buffer.from([TIPO_CAMPANHA]), uuidEmBytes(pedido.notificationId)]);
  return Buffer.concat([corpo, assinar(corpo)]).toString("base64url");
}

/** null = código incompleto, adulterado, de outro formato ou assinado com outro segredo. */
export function lerTokenDeDescadastro(token: unknown): PedidoDeDescadastro | null {
  if (typeof token !== "string") return null;
  const texto = token.trim();
  if (!texto || texto.length > TAMANHO_MAXIMO_DO_TEXTO || !BASE64URL.test(texto)) return null;

  const bytes = Buffer.from(texto, "base64url");
  // uma forma só por código: sem isso, variações no último caractere passariam
  if (bytes.toString("base64url") !== texto) return null;

  const tipo = bytes[0];
  const tamanhoEsperado = tipo === TIPO_SEGUIDOR ? TAMANHO_SEGUIDOR : tipo === TIPO_CAMPANHA ? TAMANHO_CAMPANHA : -1;
  if (bytes.length !== tamanhoEsperado) return null;

  const corpo = bytes.subarray(0, bytes.length - TAMANHO_ASSINATURA);
  const assinatura = bytes.subarray(bytes.length - TAMANHO_ASSINATURA);
  let esperada: Buffer;
  try {
    esperada = assinar(corpo);
  } catch {
    return null; // sem segredo configurado nenhum link é válido
  }
  if (!timingSafeEqual(assinatura, esperada)) return null;

  if (tipo === TIPO_SEGUIDOR) {
    return {
      tipo: "seguidor",
      organizationId: bytesEmUuid(corpo.subarray(1, 17)),
      userId: bytesEmUuid(corpo.subarray(17, 33)),
    };
  }
  return { tipo: "campanha", notificationId: bytesEmUuid(corpo.subarray(1, 17)) };
}

function semBarraNoFim(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Site (página com o botão). Sem a variável, produção cai no domínio real — localhost só em dev. */
export function enderecoDoSite(env: NodeJS.ProcessEnv = process.env): string {
  return semBarraNoFim(
    env.WEB_BASE_URL?.trim() || (env.NODE_ENV === "production" ? "https://borafest.com.br" : "http://localhost:3000"),
  );
}

/** API (um clique do Gmail/Apple Mail). Mesmo padrão do docker-compose: api.borafest.com.br. */
export function enderecoDaApi(env: NodeJS.ProcessEnv = process.env): string {
  return semBarraNoFim(
    env.API_PUBLIC_URL?.trim() ||
      (env.NODE_ENV === "production" ? "https://api.borafest.com.br" : "http://localhost:3333"),
  );
}

/**
 * pagina: o link do rodapé (site, confirma com um botão).
 * umClique: o List-Unsubscribe (API; POST descadastra, navegador é levado à página).
 */
export function linksDeDescadastro(token: string, env: NodeJS.ProcessEnv = process.env): { pagina: string; umClique: string } {
  const codigo = encodeURIComponent(token);
  return {
    pagina: `${enderecoDoSite(env)}/descadastro/${codigo}`,
    umClique: `${enderecoDaApi(env)}/v1/public/descadastro/${codigo}`,
  };
}

/** "fu***@gmail.com": a página mostra de qual e-mail se trata sem expor o endereço inteiro. */
export function mascararEmail(email: string): string {
  const limpo = email.trim();
  const arroba = limpo.lastIndexOf("@");
  if (arroba <= 0 || arroba === limpo.length - 1) return "seu e-mail";
  const local = limpo.slice(0, arroba);
  const visivel = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visivel}***@${limpo.slice(arroba + 1)}`;
}
