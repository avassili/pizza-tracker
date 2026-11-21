/**
 * Mock authentication session derived from HTTP request headers.
 * See DESIGN.md §3.3 and docs/TACTICAL-DESIGN.md §13.1.
 *
 * `tenantId` and `actor` are always resolved server-side from headers/session,
 * never from client-submitted arguments.
 */

import { headers } from "next/headers";
import { fail, ok, type Result } from "@/domain/errors";
import { isRole, type Role } from "@/domain/rbac/permissions";

export interface Session {
  tenantId: string;
  role: Role;
  actorId: string;
}

export interface HeaderReader {
  get(name: string): string | null;
}

const DEFAULT_TENANT = "acme";
const DEFAULT_ROLE: Role = "customer";

export function parseMockSessionFromHeaders(
  headerStore: HeaderReader,
  authMode: string = process.env.AUTH_MODE ?? "mock",
): Result<Session> {
  if (authMode !== "mock") {
    return fail("UNAUTHENTICATED", "Mock session is disabled outside mock auth mode");
  }

  const rawRole = headerStore.get("x-mock-role")?.trim();
  const rawTenant = headerStore.get("x-mock-tenant")?.trim();
  const rawActorId = headerStore.get("x-mock-actor-id")?.trim();

  let role: Role = DEFAULT_ROLE;
  if (rawRole) {
    if (!isRole(rawRole)) {
      return fail("UNAUTHENTICATED", `Invalid x-mock-role '${rawRole}'`, {
        field: "x-mock-role",
      });
    }
    role = rawRole;
  }

  const tenantId = rawTenant || DEFAULT_TENANT;
  const actorId = rawActorId || (role === "customer" ? "cust_anonymous" : `mock_${role}`);

  return ok({ tenantId, role, actorId });
}

export async function getSession(): Promise<Result<Session>> {
  const headerStore = await headers();
  return parseMockSessionFromHeaders(headerStore);
}
