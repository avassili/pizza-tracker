import { describe, expect, it } from "vitest";
import type { StepKey } from "./steps";
import { transition } from "./transition";
import { NOW, makeCtx, makeOrder } from "../__fixtures__/order";

const RESTARTABLE: StepKey[] = [
  "orderInProgress_Stage1",
  "orderInProgress_Stage2",
  "orderInProgress_Stage3",
];

describe("restart", () => {
  it.each(RESTARTABLE)("keeps the order on %s and bumps the counter", (step) => {
    const order = makeOrder({ stepKey: step });
    const result = transition(
      makeCtx({ order, action: { type: "restart", reason: "dropped on the floor" } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.stepKey).toBe(step);
    expect(result.order.status).toBe("active");
    expect(result.order.version).toBe(order.version + 1);
    expect(result.order.restartCount[step]).toBe(1);
    expect(result.order.stepEnteredAt).toBe(NOW);
    expect(result.events[0].type).toBe("RESTART");
    expect(result.events[0].reason).toBe("dropped on the floor");
  });

  it("accumulates restart counts across repeats", () => {
    const order = makeOrder({
      stepKey: "orderInProgress_Stage1",
      restartCount: { orderInProgress_Stage1: 2 },
    });
    const result = transition(makeCtx({ order, action: { type: "restart" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.restartCount.orderInProgress_Stage1).toBe(3);
  });

  it("does not change maxStepRank", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage2", maxStepRank: 3 });
    const result = transition(makeCtx({ order, action: { type: "restart" } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.maxStepRank).toBe(3);
  });

  it("rejects restart at orderPlaced", () => {
    const order = makeOrder();
    const result = transition(makeCtx({ order, action: { type: "restart" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_TRANSITION");
  });

  it("is not blocked by an outstanding input request", () => {
    const order = makeOrder({
      stepKey: "orderInProgress_Stage1",
      inputState: { pending: true, inputId: "in_1", schemaKey: "allergen_confirmation" },
    });
    const result = transition(makeCtx({ order, action: { type: "restart" } }));
    expect(result.ok).toBe(true);
  });
});
