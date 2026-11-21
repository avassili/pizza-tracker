import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeOrder } from "@/domain/__fixtures__/order";

const mockGetOrderByPublicToken = vi.fn();

vi.mock("@/infra/dynamodb/orderRepository", () => ({
  createDynamoOrderRepository: () => ({
    getOrderByPublicToken: mockGetOrderByPublicToken,
  }),
}));

describe("GET /api/t/[tenant]/orders/[token]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 TrackerViewModel with ETag and Cache-Control: no-store", async () => {
    const order = makeOrder({ tenantId: "acme", version: 3 });
    mockGetOrderByPublicToken.mockResolvedValue(order);

    const { GET } = await import("./route");
    const req = new NextRequest(`http://localhost:3000/api/t/acme/orders/${order.publicToken}`);
    const res = await GET(req, {
      params: Promise.resolve({ tenant: "acme", token: order.publicToken }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe('W/"3"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.json();
    expect(body.order.publicToken).toBe(order.publicToken);
    expect(body.milestones).toHaveLength(5);
    expect(body.version).toBe(3);
  });

  it("returns 304 Not Modified when If-None-Match matches the ETag", async () => {
    const order = makeOrder({ tenantId: "acme", version: 3 });
    mockGetOrderByPublicToken.mockResolvedValue(order);

    const { GET } = await import("./route");
    const req = new NextRequest(`http://localhost:3000/api/t/acme/orders/${order.publicToken}`, {
      headers: { "if-none-match": 'W/"3"' },
    });
    const res = await GET(req, {
      params: Promise.resolve({ tenant: "acme", token: order.publicToken }),
    });

    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe('W/"3"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 404 when the token does not exist or belongs to another tenant", async () => {
    mockGetOrderByPublicToken.mockResolvedValue(makeOrder({ tenantId: "other-store" }));

    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost:3000/api/t/acme/orders/UNKNOWN");
    const res = await GET(req, {
      params: Promise.resolve({ tenant: "acme", token: "UNKNOWN" }),
    });

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
