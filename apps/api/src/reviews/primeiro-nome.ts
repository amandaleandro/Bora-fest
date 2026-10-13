/**
 * AVALIAÇÃO PÚBLICA SÓ COM O PRIMEIRO NOME (LGPD, 2026-10-12). A página do
 * evento é aberta a qualquer um: o nome completo de quem comentou não sai dali.
 * Nome que é um e-mail (conta criada sem nome vira "fulano@...") não sai de
 * jeito nenhum — sem nome, a tela mostra o comentário sem autor.
 */
export function primeiroNome(nome: string | null | undefined): string | null {
  const primeiro = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!primeiro || primeiro.includes("@")) return null;
  return primeiro.slice(0, 40);
}
