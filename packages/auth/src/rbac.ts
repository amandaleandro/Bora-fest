export const PERMISSIONS = {
  ORG_MANAGE_MEMBERS: "org:manage_members",
  EVENT_CREATE: "event:create",
  EVENT_PUBLISH: "event:publish",
  ORDER_REFUND: "order:refund",
  FINANCE_VIEW: "finance:view",
  CHECKIN_PERFORM: "checkin:perform",
  SALES_PERFORM: "sales:perform",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  owner: Object.values(PERMISSIONS),
  // 2026-09-07 (pos-mortem do Hello World): o admin VENDIA na porta mas nao
  // podia VALIDAR — e a venda na porta faz check-in automatico. O check-in
  // levava 403 e o erro era engolido: o cliente pagava e nao era liberado.
  // Quem pode estornar dinheiro e publicar evento pode escanear um ingresso.
  admin: [
    PERMISSIONS.ORG_MANAGE_MEMBERS,
    PERMISSIONS.EVENT_CREATE,
    PERMISSIONS.EVENT_PUBLISH,
    PERMISSIONS.ORDER_REFUND,
    PERMISSIONS.FINANCE_VIEW,
    PERMISSIONS.SALES_PERFORM,
    PERMISSIONS.CHECKIN_PERFORM,
  ],
  finance: [PERMISSIONS.FINANCE_VIEW, PERMISSIONS.ORDER_REFUND],
  operator: [PERMISSIONS.CHECKIN_PERFORM],
  // Vendedor = papel "da porta": vende no PDV E valida a entrada (check-in).
  // Venda no PDV é presencial, na hora da festa — quem está na porta vendendo
  // também precisa liberar quem chega (a venda na porta já faz check-in
  // automático). Quem só valida (staff de portão) usa o papel "operator".
  seller: [PERMISSIONS.SALES_PERFORM, PERMISSIONS.CHECKIN_PERFORM],
};

export function roleHasPermission(roleKey: string, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[roleKey]?.includes(permission) ?? false;
}
