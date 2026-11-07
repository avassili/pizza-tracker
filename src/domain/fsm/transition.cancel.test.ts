import { describe, expect, it } from "vitest";
import { transition } from "./transition";
import { NOW, makeCtx, makeOrder } from "../__fixtures__/order";

describe("cancel", () => {
  it("requires a reason of at least three characters", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage2" });
    for (const reason of ["", "no", "  a  "]) {
      const result = transition(makeCtx({ order, action: { type: "cancel", reason } }));
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("freezes the step and records where the order died", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage2" });
    const result = transition(
      makeCtx({
        order,
        action: { type: "cancel", reason: "customer changed their mind" },
        role: "store_manager",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.status).toBe("cancelled");
    expect(result.order.stepKey).toBe("orderInProgress_Stage2");
    expect(result.order.cancelledAtStep).toBe("orderInProgress_Stage2");
    expect(result.order.cancelledAt).toBe(NOW);
    expect(result.order.cancelReason).toBe("customer changed their mind");
    expect(result.order.version).toBe(order.version + 1);
    expect(result.events[0].type).toBe("CANCEL");
    expect(result.events[0].reason).toBe("customer changed their mind");
  });

  it("clears any outstanding input request", () => {
    const order = makeOrder({
      stepKey: "orderInProgress_Stage1",
      inputState: { pending: true, inputId: "in_1", schemaKey: "allergen_confirmation" },
    });
    const result = transition(
      makeCtx({
        order,
        action: { type: "cancel", reason: "out of stock" },
        role: "store_manager",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.inputState.pending).toBe(false);
  });

  it("is denied to kitchen staff", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage1" });
    const result = transition(
      makeCtx({ order, action: { type: "cancel", reason: "nope" }, role: "kitchen_staff" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });
});
