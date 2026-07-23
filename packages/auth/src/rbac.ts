export const PERMISSIONS = {
  ORG_MANAGE_MEMBERS: "org:manage_members",
  EVENT_CREATE: "event:create",
  EVENT_PUBLISH: "event:publish",
  ORDER_REFUND: "order:refund",
  FINANCE_VIEW: "finance:view",
  CHECKIN_PERFORM: "checkin:perform",
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
  ],
  finance: [PERMISSIONS.FINANCE_VIEW, PERMISSIONS.ORDER_REFUND],
  operator: [PERMISSIONS.CHECKIN_PERFORM],
};

export function roleHasPermission(roleKey: string, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[roleKey]?.includes(permission) ?? false;
}
