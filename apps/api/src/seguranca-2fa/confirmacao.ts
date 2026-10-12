import { createSessionToken, verifySessionToken } from "@borafest/auth";

/**
 * Confirmação de curta duração do 2FA (2026-10-12). Depois que o staff digita
 * o código do app autenticador, a API devolve este token: vale 10 minutos, só
 * para AQUELE usuário e só enquanto a sessão dele não for revogada (sv). O
 * backoffice manda o token no cabeçalho abaixo nas ações de dinheiro.
 *
 * É assinado com o mesmo segredo da sessão, mas com `purpose`: o
 * resolveSessionUserId recusa qualquer token com purpose, então a confirmação
 * nunca vale como login, e um token de sessão nunca vale como confirmação.
 */
export const CONFIRMACAO_2FA_HEADER = "x-confirmacao-2fa";
export const CONFIRMACAO_2FA_PROPOSITO = "admin-2fa";
export const CONFIRMACAO_2FA_MINUTOS = 10;

/** códigos de erro lidos pelo backoffice para decidir entre "ative" e "digite o código" */
export const ERRO_2FA_NAO_ATIVADO = "2FA_NAO_ATIVADO";
export const ERRO_2FA_CONFIRMACAO_NECESSARIA = "2FA_CONFIRMACAO_NECESSARIA";

export const MENSAGEM_2FA_NAO_ATIVADO =
  "Esta ação mexe com dinheiro e exige a verificação em duas etapas. Ative em Segurança, no menu do backoffice, e tente de novo.";

export async function emitirConfirmacao2fa(
  userId: string,
  sessionVersion: number,
): Promise<{ confirmacao: string; expiraEm: string }> {
  const expiraEm = new Date(Date.now() + CONFIRMACAO_2FA_MINUTOS * 60_000);
  const confirmacao = await createSessionToken(
    { sub: userId, purpose: CONFIRMACAO_2FA_PROPOSITO, sv: sessionVersion },
    `${CONFIRMACAO_2FA_MINUTOS}m`,
  );
  return { confirmacao, expiraEm: expiraEm.toISOString() };
}

/** true só para confirmação 2FA íntegra, no prazo, do MESMO usuário e da sessão atual */
export async function confirmacao2faValida(
  token: string,
  userId: string,
  sessionVersion: number,
): Promise<boolean> {
  let claims;
  try {
    claims = await verifySessionToken(token);
  } catch {
    return false; // assinatura errada, adulterada ou expirada
  }
  const versaoDoToken = typeof claims.sv === "number" ? claims.sv : 0;
  return (
    claims.purpose === CONFIRMACAO_2FA_PROPOSITO &&
    claims.sub === userId &&
    versaoDoToken === sessionVersion
  );
}
