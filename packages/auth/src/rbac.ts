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
  admin: [
    PERMISSIONS.ORG_MANAGE_MEMBERS,
    PERMISSIONS.EVENT_CREATE,
    PERMISSIONS.EVENT_PUBLISH,
    PERMISSIONS.ORDER_REFUND,
    PERMISSIONS.FINANCE_VIEW,
    PERMISSIONS.SALES_PERFORM,
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
