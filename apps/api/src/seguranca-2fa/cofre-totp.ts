import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cofre do segredo TOTP (2026-10-12): o segredo do app autenticador NUNCA vai
 * ao banco em texto puro. Quem lesse um backup ou a tabela users conseguiria
 * gerar os códigos de todos os admins. Cifra AES-256-GCM com a chave mestra da
 * variável TOTP_ENCRYPTION_KEY, e o id do usuário entra como dado autenticado
 * (AAD): copiar o segredo de uma linha para outra não funciona.
 *
 * Sem a variável (ou com ela curta demais) o 2FA não pode ser ativado. Quem
 * chama recusa com mensagem clara em vez de guardar o segredo aberto.
 */
export const TOTP_CHAVE_ENV = "TOTP_ENCRYPTION_KEY";
/**
 * `openssl rand -base64 32` (o mesmo comando da TICKET_KEY_ENCRYPTION_KEY)
 * gera 44 caracteres; 32 é o mínimo aceito. A chave AES sai do SHA-256 do
 * texto, então base64 ou hex servem igual.
 */
export const TOTP_CHAVE_TAMANHO_MINIMO = 32;
const VERSAO = "v1";

/** Chave AES de 32 bytes derivada da variável, ou null se ela falta ou é curta. */
export function chaveMestraTotp(): Buffer | null {
  const bruta = process.env[TOTP_CHAVE_ENV]?.trim();
  if (!bruta || bruta.length < TOTP_CHAVE_TAMANHO_MINIMO) return null;
  return createHash("sha256").update(bruta, "utf8").digest();
}

/** Formato guardado: v1:<iv>:<tag>:<cifrado>, cada parte em base64. */
export function cifrarSegredoTotp(segredo: Buffer, userId: string, chave: Buffer): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave, iv);
  cifra.setAAD(Buffer.from(userId, "utf8"));
  const cifrado = Buffer.concat([cifra.update(segredo), cifra.final()]);
  const tag = cifra.getAuthTag();
  return [VERSAO, iv.toString("base64"), tag.toString("base64"), cifrado.toString("base64")].join(":");
}

/** Lança se a chave mudou, se o texto foi adulterado ou se é de outro usuário. */
export function decifrarSegredoTotp(guardado: string, userId: string, chave: Buffer): Buffer {
  const [versao, iv, tag, cifrado] = guardado.split(":");
  if (versao !== VERSAO || !iv || !tag || !cifrado) {
    throw new Error("Formato do segredo TOTP desconhecido");
  }
  const decifra = createDecipheriv("aes-256-gcm", chave, Buffer.from(iv, "base64"));
  decifra.setAAD(Buffer.from(userId, "utf8"));
  decifra.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decifra.update(Buffer.from(cifrado, "base64")), decifra.final()]);
}
