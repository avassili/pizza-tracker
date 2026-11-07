import { describe, expect, it } from "vitest";
import { withConfig } from "../config/schema";
import type { Role } from "../rbac/permissions";
import { STEP_RANK, type StepKey } from "./steps";
import { transition } from "./transition";
import { NOW, makeCtx, makeOrder } from "../__fixtures__/order";

// Completing a dispatch is the driver's permission, not the kitchen's (§9).
const FORWARD: Array<[StepKey, StepKey, Role]> = [
  ["orderPlaced", "orderInProgress_Stage1", "kitchen_staff"],
  ["orderInProgress_Stage1", "orderInProgress_Stage2", "kitchen_staff"],
  ["orderInProgress_Stage2", "orderInProgress_Stage3", "kitchen_staff"],
  ["orderInProgress_Stage3", "orderComplete", "delivery_driver"],
];

describe("advance", () => {
  it.each(FORWARD)("moves %s to %s as %s", (from, to, role) => {
    const order = makeOrder({ stepKey: from });
    const result = transition(makeCtx({ order, action: { type: "advance" }, role }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.stepKey).toBe(to);
    expect(result.order.stepRank).toBe(STEP_RANK[to]);
    expect(result.order.version).toBe(order.version + 1);
    expect(result.order.stepEnteredAt).toBe(NOW);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe("ADVANCE");
    expect(result.events[0].fromStep).toBe(from);
    expect(result.events[0].toStep).toBe(to);
    expect(result.events[0].orderVersion).toBe(order.version + 1);
    expect(result.notices.length).toBeGreaterThan(0);
  });

  it("closes the previous timeline entry and opens a new one", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage1" });
    const result = transition(makeCtx({ order, action: { type: "advance" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const timeline = result.order.timeline;
    expect(timeline).toHaveLength(2);
    expect(timeline[0].exitedAt).toBe(NOW);
    expect(timeline[1]).toMatchObject({ stepKey: "orderInProgress_Stage2", enteredAt: NOW });
  });

  it("emits ORDER_COMPLETED when the flow finishes", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage3" });
    const result = transition(
      makeCtx({ order, action: { type: "advance" }, role: "delivery_driver" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.status).toBe("completed");
    expect(result.order.completedAt).toBe(NOW);
    expect(result.notices.map((notice) => notice.kind)).toContain("ORDER_COMPLETED");
  });

  it("rejects advancing a completed order", () => {
    const order = makeOrder({ stepKey: "orderComplete" });
    const result = transition(makeCtx({ order, action: { type: "advance" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TERMINAL_STATE");
  });

  it("rejects advancing a cancelled order", () => {
    const order = makeOrder({
      status: "cancelled",
      stepKey: "orderInProgress_Stage2",
      cancelledAt: NOW,
      cancelledAtStep: "orderInProgress_Stage2",
      cancelReason: "customer changed their mind",
    });
    const result = transition(makeCtx({ order, action: { type: "advance" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TERMINAL_STATE");
  });

  it("blocks completion when payment is not settled", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage3", paymentStatus: "unpaid" });
    const result = transition(
      makeCtx({ order, action: { type: "advance" }, role: "delivery_driver" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PAYMENT_NOT_SETTLED");
  });

  it("allows completion when the tenant waives the payment rule", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage3", paymentStatus: "unpaid" });
    const config = withConfig({
      businessRules: {
        allowAdvanceWhileAwaitingInput: false,
        requirePaymentSettledToComplete: false,
      },
    });
    const result = transition(
      makeCtx({ order, action: { type: "advance" }, config, role: "delivery_driver" }),
    );
    expect(result.ok).toBe(true);
  });
});
