import { prisma } from "@borafest/database";
import { verifySessionToken } from "@borafest/auth";

/**
 * Resolve o userId de um Bearer token aplicando TODAS as regras de sessão num
 * lugar só (auditoria 2026-08-30): o SessionGuard e o OptionalUserId faziam a
 * verificação separados, e o decorator não checava `purpose` nem
 * `session_version` — um token de e-mail ou uma sessão revogada passava por
 * qualquer rota que usasse OptionalUserId. Agora os dois chamam isto.
 *
 * Devolve o userId ou null (token ausente/inválido, token de propósito único,
 * ou sessão revogada por troca de senha).
 */
export async function resolveSessionUserId(authHeader?: string): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  let claims;
  try {
    claims = await verifySessionToken(authHeader.slice("Bearer ".length));
  } catch {
    return null;
  }

  // token de propósito único (link mágico/verificação de e-mail) não é sessão
  if (typeof claims.purpose === "string" && claims.purpose.length > 0) return null;
  if (!claims.sub) return null;

  const user = await prisma.user.findUnique({
    where: { id: claims.sub as string },
    select: { sessionVersion: true },
  });
  const versaoDoToken = typeof claims.sv === "number" ? claims.sv : 0;
  if (!user || user.sessionVersion !== versaoDoToken) return null;

  return claims.sub as string;
}
