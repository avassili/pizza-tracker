/**
 * Role/permission grammar. See docs/TACTICAL-DESIGN.md §9.
 *
 * Permissions are colon-separated segments; `*` matches exactly one whole
 * segment and only when the segment count is equal, so `step:advance:*`
 * grants `step:advance:orderPlaced` but never a bare `step:advance`.
 */

import type { StepKey } from "../fsm/steps";

export const ROLES = [
  "customer",
  "kitchen_staff",
  "delivery_driver",
  "store_manager",
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export type MovementKind = "advance" | "restart" | "loopback";

export type Permission =
  | "order:create"
  | "order:read"
  | "order:read_public"
  | "order:cancel"
  | `step:${MovementKind}:${StepKey | "*"}`
  | "input:request"
  | "input:submit"
  | "tenant:config:write";

export function can(granted: readonly string[], required: string): boolean {
  const requiredSegments = required.split(":");
  return granted.some((grant) => {
    const segments = grant.split(":");
    if (segments.length !== requiredSegments.length) return false;
    return segments.every(
      (segment, index) => segment === "*" || segment === requiredSegments[index],
    );
  });
}

const KITCHEN: Permission[] = [
  "order:read",
  "step:advance:orderPlaced",
  "step:advance:orderInProgress_Stage1",
  "step:advance:orderInProgress_Stage2",
  // Restart is structurally impossible below Stage1 (see fsm/resolve.ts), so the
  // grant is deliberately not issued for orderPlaced.
  "step:restart:orderInProgress_Stage1",
  "step:restart:orderInProgress_Stage2",
  "step:restart:orderInProgress_Stage3",
  "step:loopback:orderInProgress_Stage1",
  "step:loopback:orderInProgress_Stage2",
  "input:request",
];

const DRIVER: Permission[] = [
  "order:read",
  "step:advance:orderInProgress_Stage3",
  "step:restart:orderInProgress_Stage3",
  "step:loopback:orderInProgress_Stage3",
  "input:request",
];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  customer: ["order:create", "order:read_public", "input:submit"],
  kitchen_staff: KITCHEN,
  delivery_driver: DRIVER,
  // Explicit list rather than a literal "*" wildcard, so the grant stays auditable.
  store_manager: [
    ...KITCHEN,
    ...DRIVER,
    "order:create",
    "order:read_public",
    "order:cancel",
    "input:submit",
    "tenant:config:write",
  ],
};
