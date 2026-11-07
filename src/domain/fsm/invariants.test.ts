import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_CONFIG, withConfig } from "../config/schema";
import { queueBucket, isRecheck, etaFor } from "./selectors";
import { transition } from "./transition";
import { NOW, makeCtx, makeOrder } from "../__fixtures__/order";

describe("guard order and terminal handling", () => {
  it("reports TERMINAL_STATE before FORBIDDEN", () => {
    // kitchen_staff has no step:advance:orderComplete grant, yet the order is
    // already complete: terminal must win, because it leaks no role information.
    const order = makeOrder({ stepKey: "orderComplete" });
    const result = transition(makeCtx({ order, action: { type: "advance" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TERMINAL_STATE");
  });

  it("rejects an unknown role as UNAUTHENTICATED", () => {
    const order = makeOrder();
    const config = withConfig({ rolePermissions: {} });
    const result = transition(makeCtx({ order, action: { type: "advance" }, config }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("UNAUTHENTICATED");
  });

  it("denies kitchen staff advancing out of dispatch", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage3" });
    const result = transition(makeCtx({ order, action: { type: "advance" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("denies the driver advancing out of prep", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage1" });
    const result = transition(
      makeCtx({ order, action: { type: "advance" }, role: "delivery_driver" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });

  it("lets the driver complete a paid dispatch order", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage3" });
    const result = transition(
      makeCtx({ order, action: { type: "advance" }, role: "delivery_driver" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe("completed");
    expect(result.order.stepKey).toBe("orderComplete");
    expect(queueBucket(result.order)).toBe("terminal");
  });
});

describe("sequence invariants", () => {
  it("increments version by exactly one per accepted action", () => {
    let order = makeOrder();
    const actions = [
      { type: "advance" as const },
      { type: "restart" as const, reason: "dropped" },
      { type: "advance" as const },
      { type: "loopback" as const },
    ];

    let expected = order.version;
    for (const action of actions) {
      const result = transition(makeCtx({ order, action }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expected += 1;
      expect(result.order.version).toBe(expected);
      order = result.order;
    }
  });

  it("never lets maxStepRank decrease", () => {
    let order = makeOrder({ stepKey: "orderInProgress_Stage3", maxStepRank: 3 });
    const actions = [
      { type: "loopback" as const },
      { type: "loopback" as const },
      { type: "restart" as const },
      { type: "advance" as const },
    ];

    let previous = order.maxStepRank;
    for (const action of actions) {
      // store_manager holds every step permission, so the sequence exercises the
      // FSM rather than the permission matrix.
      const result = transition(
        makeCtx({ order, action, role: "store_manager" }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.order.maxStepRank).toBeGreaterThanOrEqual(previous);
      previous = result.order.maxStepRank;
      order = result.order;
    }
  });

  it("keeps exactly one queue bucket through the whole lifecycle", () => {
    const active = makeOrder({ stepKey: "orderInProgress_Stage2" });
    expect(queueBucket(active)).toBe("active");

    const done = makeOrder({ stepKey: "orderComplete" });
    expect(queueBucket(done)).toBe("terminal");

    const cancelled = makeOrder({
      status: "cancelled",
      stepKey: "orderInProgress_Stage2",
      cancelledAtStep: "orderInProgress_Stage2",
      cancelReason: "test",
    });
    expect(queueBucket(cancelled)).toBe("terminal");
  });
});

describe("read-model selectors", () => {
  it("flags a recheck after a loopback", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage1", maxStepRank: 3 });
    expect(isRecheck(order)).toBe(true);
    expect(isRecheck(makeOrder({ stepKey: "orderInProgress_Stage3" }))).toBe(false);
  });

  it("computes an ETA from configured durations", () => {
    const order = makeOrder({
      stepKey: "orderInProgress_Stage1",
      stepEnteredAt: NOW,
    });
    const eta = etaFor(DEFAULT_TENANT_CONFIG, order, Date.parse(NOW));
    // stage1 has just started: 240s left + stage2 480s + stage3 420s = 1140s
    expect(eta.etaMinutes).toBe(19);
  });

  it("returns no ETA for terminal orders", () => {
    const completed = makeOrder({ stepKey: "orderComplete" });
    expect(etaFor(DEFAULT_TENANT_CONFIG, completed, Date.parse(NOW))).toEqual({
      etaIso: null,
      etaMinutes: null,
    });
  });

  it("sums only the steps ahead of the current rank", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage3", stepEnteredAt: NOW });
    const eta = etaFor(DEFAULT_TENANT_CONFIG, order, Date.parse(NOW));
    // stage3 has just started: only its own 420s remains => 7 minutes
    expect(eta.etaMinutes).toBe(7);
  });
});
