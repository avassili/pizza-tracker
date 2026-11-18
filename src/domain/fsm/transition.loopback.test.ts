import { describe, expect, it } from "vitest";
import { STEP_RANK } from "./steps";
import { transition } from "./transition";
import { makeCtx, makeOrder } from "../__fixtures__/order";

describe("loopback", () => {
  it("walks Stage3 -> Stage2 -> Stage1 -> orderPlaced", () => {
    let order = makeOrder({ stepKey: "orderInProgress_Stage3", maxStepRank: 3 });
    const visited: string[] = [];

    for (const expected of [
      "orderInProgress_Stage2",
      "orderInProgress_Stage1",
      "orderPlaced",
    ]) {
      const result = transition(
        makeCtx({ order, action: { type: "loopback" }, role: "store_manager" }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      order = result.order;
      expect(order.stepKey).toBe(expected);
      expect(order.stepRank).toBe(STEP_RANK[expected as keyof typeof STEP_RANK]);
      expect(result.events[0].type).toBe("LOOPBACK");
      visited.push(order.stepKey);
    }

    expect(visited).toEqual([
      "orderInProgress_Stage2",
      "orderInProgress_Stage1",
      "orderPlaced",
    ]);
  });

  it("preserves maxStepRank so the customer view never regresses", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage2", maxStepRank: 3 });
    const result = transition(makeCtx({ order, action: { type: "loopback" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.maxStepRank).toBe(3);
    expect(result.order.stepRank).toBe(1);
    expect(result.order.maxStepRank).toBeGreaterThan(result.order.stepRank);
  });

  it("rejects loopback from orderPlaced", () => {
    const order = makeOrder();
    const result = transition(makeCtx({ order, action: { type: "loopback" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_TRANSITION");
  });

  it("records the reason on the event", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage1" });
    const result = transition(
      makeCtx({ order, action: { type: "loopback", reason: "wrong base sauce" } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0].reason).toBe("wrong base sauce");
    expect(result.notices.map((notice) => notice.kind)).toContain("ORDER_LOOPBACKED");
  });
});
