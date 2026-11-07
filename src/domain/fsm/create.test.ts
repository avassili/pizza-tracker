import { describe, expect, it } from "vitest";
import { createOrderSnapshot, type CreateOrderParams } from "./create";
import { NOW } from "../__fixtures__/order";

const base: CreateOrderParams = {
  tenantId: "acme",
  configVersion: 1,
  now: NOW,
  actorId: "cust_1",
  customer: { name: "Ada Lovelace" },
  items: [{ name: "Margherita", size: "Large", toppings: ["basil"], qty: 1 }],
  totals: { subtotalCents: 1000, taxCents: 80, totalCents: 1080, currency: "USD" },
};

describe("createOrderSnapshot", () => {
  it("mints a v1 order at orderPlaced", () => {
    const result = createOrderSnapshot(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.status).toBe("active");
    expect(result.order.stepKey).toBe("orderPlaced");
    expect(result.order.stepRank).toBe(0);
    expect(result.order.maxStepRank).toBe(0);
    expect(result.order.version).toBe(1);
    expect(result.order.publicToken).toHaveLength(26);
    expect(result.order.orderId).toHaveLength(26);
    expect(result.order.inputState.pending).toBe(false);
    expect(result.order.timeline).toHaveLength(1);
    expect(result.events[0].type).toBe("ORDER_PLACED");
    expect(result.events[0].orderVersion).toBe(1);
  });

  it("mints a distinct token and id per order", () => {
    const a = createOrderSnapshot(base);
    const b = createOrderSnapshot(base);
    if (!a.ok || !b.ok) throw new Error("expected both to succeed");
    expect(a.order.orderId).not.toBe(b.order.orderId);
    expect(a.order.publicToken).not.toBe(b.order.publicToken);
  });

  it("honours injected ids for deterministic tests", () => {
    const result = createOrderSnapshot({ ...base, orderId: "FIXED", token: "TOKENFIXED" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.orderId).toBe("FIXED");
    expect(result.order.publicToken).toBe("TOKENFIXED");
  });

  it("rejects an order with no items", () => {
    const result = createOrderSnapshot({ ...base, items: [] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-positive quantity", () => {
    const result = createOrderSnapshot({
      ...base,
      items: [{ name: "Margherita", size: "Large", toppings: [], qty: 0 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects negative totals", () => {
    const result = createOrderSnapshot({
      ...base,
      totals: { subtotalCents: -1, taxCents: 0, totalCents: 0, currency: "USD" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a blank customer name", () => {
    const result = createOrderSnapshot({ ...base, customer: { name: "   " } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});
