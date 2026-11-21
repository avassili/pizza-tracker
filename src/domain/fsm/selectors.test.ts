import { describe, expect, it } from "vitest";
import { DEFAULT_TENANT_CONFIG } from "../config/schema";
import { EARLIER, makeOrder, NOW } from "../__fixtures__/order";
import { toTrackerViewModel } from "./selectors";

describe("toTrackerViewModel", () => {
  it("always emits 5 milestones and hides internal fields", () => {
    const order = makeOrder({
      stepKey: "orderPlaced",
      stepRank: 0,
      maxStepRank: 0,
      restartCount: { orderInProgress_Stage1: 2 },
    });

    const vm = toTrackerViewModel(DEFAULT_TENANT_CONFIG, order, Date.parse(EARLIER));

    expect(vm.milestones).toHaveLength(5);
    expect(vm.milestones.map((m) => m.state)).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(vm.order).toEqual({
      publicToken: order.publicToken,
      status: "active",
      placedAt: order.createdAt,
    });
    expect("orderId" in vm.order).toBe(false);
    expect("restartCount" in vm).toBe(false);
    expect(vm.etaIso).not.toBeNull();
    expect(vm.etaMinutes).toBeGreaterThan(0);
  });

  it("masks loopbacks via maxStepRank and flags recheck", () => {
    const order = makeOrder({
      stepKey: "orderInProgress_Stage1",
      stepRank: 1,
      maxStepRank: 2,
    });

    const vm = toTrackerViewModel(DEFAULT_TENANT_CONFIG, order, Date.parse(NOW));

    expect(vm.recheck).toBe(true);
    expect(vm.milestones.map((m) => m.state)).toEqual([
      "done",
      "current",
      "done",
      "upcoming",
      "upcoming",
    ]);
  });

  it("translates pending input and clears ETA when completed or cancelled", () => {
    const completed = makeOrder({ stepKey: "orderComplete", status: "completed" });
    const completedVm = toTrackerViewModel(DEFAULT_TENANT_CONFIG, completed, Date.parse(NOW), "es");
    expect(completedVm.etaIso).toBeNull();
    expect(completedVm.tenant.locale).toBe("es");
    expect(completedVm.milestones.every((m) => m.state === "done")).toBe(true);

    const cancelled = makeOrder({
      stepKey: "orderInProgress_Stage2",
      status: "cancelled",
      cancelledAt: NOW,
      cancelReason: "Out of dough",
    });
    const cancelledVm = toTrackerViewModel(DEFAULT_TENANT_CONFIG, cancelled, Date.parse(NOW));
    expect(cancelledVm.etaIso).toBeNull();
    expect(cancelledVm.cancelled).toEqual({ at: NOW, reason: "Out of dough" });
  });
});
