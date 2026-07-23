/**
 * Papel de equipe interna da BoraFest (backoffice) — independente das roles
 * de organização (owner/admin/finance/operator). SUPPORT vê e consulta;
 * ADMIN também executa ações sensíveis (estorno, bloqueio, taxa).
 */
export type PlatformRole = "SUPPORT" | "ADMIN";

export function isPlatformStaff(role: PlatformRole | null | undefined): boolean {
  return role === "SUPPORT" || role === "ADMIN";
}

export function isPlatformAdmin(role: PlatformRole | null | undefined): boolean {
  return role === "ADMIN";
}
