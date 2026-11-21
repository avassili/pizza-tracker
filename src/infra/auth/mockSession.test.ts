import { describe, expect, it, vi } from "vitest";
import { parseMockSessionFromHeaders } from "./mockSession";

function makeHeaders(entries: Record<string, string>) {
  return {
    get(name: string) {
      return entries[name.toLowerCase()] ?? null;
    },
  };
}

describe("parseMockSessionFromHeaders", () => {
  it("falls back to lowest-privilege customer/acme when headers are absent", () => {
    const res = parseMockSessionFromHeaders(makeHeaders({}), "mock");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({
      tenantId: "acme",
      role: "customer",
      actorId: "cust_anonymous",
    });
  });

  it("reads x-mock-role, x-mock-tenant, and x-mock-actor-id", () => {
    const res = parseMockSessionFromHeaders(
      makeHeaders({
        "x-mock-role": "kitchen_staff",
        "x-mock-tenant": "bella-napoli",
        "x-mock-actor-id": "chef_42",
      }),
      "mock",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({
      tenantId: "bella-napoli",
      role: "kitchen_staff",
      actorId: "chef_42",
    });
  });

  it("rejects unknown roles with UNAUTHENTICATED", () => {
    const res = parseMockSessionFromHeaders(
      makeHeaders({ "x-mock-role": "superadmin" }),
      "mock",
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects mock auth outside mock mode", () => {
    const res = parseMockSessionFromHeaders(makeHeaders({}), "cognito");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("UNAUTHENTICATED");
  });

  it("reads awaited Next.js headers() in getSession()", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      headers: async () =>
        makeHeaders({
          "x-mock-role": "store_manager",
          "x-mock-tenant": "acme",
        }),
    }));
    const { getSession } = await import("./mockSession");
    const res = await getSession();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.role).toBe("store_manager");
    vi.doUnmock("next/headers");
    vi.resetModules();
  });
});
