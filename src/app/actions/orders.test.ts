import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail } from "@/domain/errors";

const mockGetSession = vi.fn();
const mockCreateOrder = vi.fn();
const mockRevalidatePath = vi.fn();
const mockEmitNotices = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: mockRevalidatePath,
}));

vi.mock("@/infra/auth/mockSession", () => ({
  getSession: mockGetSession,
}));

vi.mock("@/infra/dynamodb/orderRepository", () => ({
  createDynamoOrderRepository: () => ({
    createOrder: mockCreateOrder,
  }),
}));

vi.mock("@/infra/notifications/consoleChannel", () => ({
  emitNotices: mockEmitNotices,
}));

const validInput = {
  customer: { name: "Ada Lovelace", locale: "en" },
  items: [{ name: "Margherita", size: "Large", toppings: ["basil"], qty: 1 }],
  totals: { subtotalCents: 1800, taxCents: 144, totalCents: 1944, currency: "USD" },
};

describe("createOrderAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an order using session tenant/actor, emits notices, and revalidates paths", async () => {
    mockGetSession.mockResolvedValue(
      ok({ tenantId: "acme", role: "customer", actorId: "cust_1" }),
    );
    mockCreateOrder.mockImplementation(async (order) => ok(order));

    const { createOrderAction } = await import("./orders");
    const result = await createOrderAction(validInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.tenantId).toBe("acme");
    expect(result.order.stepKey).toBe("orderPlaced");
    expect(result.order.version).toBe(1);
    expect(result.notices).toHaveLength(2);
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    expect(mockEmitNotices).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      `/t/acme/track/${result.order.publicToken}`,
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/t/acme/queue");
  });

  it("rejects roles without order:create permission", async () => {
    mockGetSession.mockResolvedValue(
      ok({ tenantId: "acme", role: "kitchen_staff", actorId: "chef_1" }),
    );

    const { createOrderAction } = await import("./orders");
    const result = await createOrderAction(validInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("propagates validation failures before hitting DynamoDB", async () => {
    mockGetSession.mockResolvedValue(
      ok({ tenantId: "acme", role: "customer", actorId: "cust_1" }),
    );

    const { createOrderAction } = await import("./orders");
    const result = await createOrderAction({ ...validInput, items: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("propagates unauthenticated session failures", async () => {
    mockGetSession.mockResolvedValue(fail("UNAUTHENTICATED", "Invalid role"));

    const { createOrderAction } = await import("./orders");
    const result = await createOrderAction(validInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHENTICATED");
  });
});
