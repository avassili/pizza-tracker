import { describe, expect, it } from "vitest";
import { withConfig } from "../config/schema";
import { transition } from "./transition";
import { NOW, makeCtx, makeOrder } from "../__fixtures__/order";

const pendingOrder = (schemaKey: string, inputId = "in_1") =>
  makeOrder({
    stepKey: "orderInProgress_Stage2",
    inputState: { pending: true, inputId, schemaKey, requestedAt: NOW, requestedBy: "staff_1" },
  });

describe("requestInput", () => {
  it("records a pending input without moving the step", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage2" });
    const result = transition(
      makeCtx({ order, action: { type: "requestInput", schemaKey: "remake_consent" } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.stepKey).toBe("orderInProgress_Stage2");
    expect(result.order.inputState.pending).toBe(true);
    expect(result.order.inputState.schemaKey).toBe("remake_consent");
    expect(result.order.version).toBe(order.version + 1);
    expect(result.input?.status).toBe("pending");
    expect(result.events[0].type).toBe("INPUT_REQUESTED");
  });

  it("rejects a second outstanding request", () => {
    const order = pendingOrder("remake_consent");
    const result = transition(
      makeCtx({ order, action: { type: "requestInput", schemaKey: "remake_consent" } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INPUT_PENDING");
  });

  it("rejects an unknown schema", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage2" });
    const result = transition(
      makeCtx({ order, action: { type: "requestInput", schemaKey: "does_not_exist" } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("advance while awaiting input", () => {
  it("is blocked by an outstanding request", () => {
    const order = pendingOrder("remake_consent");
    const result = transition(makeCtx({ order, action: { type: "advance" } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INPUT_PENDING");
  });

  it("is allowed when the tenant opts in", () => {
    const order = pendingOrder("remake_consent");
    const config = withConfig({
      businessRules: {
        allowAdvanceWhileAwaitingInput: true,
        requirePaymentSettledToComplete: true,
      },
    });
    const result = transition(makeCtx({ order, action: { type: "advance" }, config }));
    expect(result.ok).toBe(true);
  });
});

describe("submitInput", () => {
  it("rejects a submission when nothing is pending", () => {
    const order = makeOrder({ stepKey: "orderInProgress_Stage2" });
    const result = transition(
      makeCtx({
        order,
        role: "customer",
        action: { type: "submitInput", inputId: "in_1", response: { decision: "accept" } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INPUT_NOT_PENDING");
  });

  it("rejects a mismatched input id", () => {
    const order = pendingOrder("remake_consent", "in_1");
    const result = transition(
      makeCtx({
        order,
        role: "customer",
        action: { type: "submitInput", inputId: "in_other", response: { decision: "accept" } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an unparseable decision", () => {
    const order = pendingOrder("remake_consent");
    const result = transition(
      makeCtx({
        order,
        role: "customer",
        action: { type: "submitInput", inputId: "in_1", response: { decision: "maybe" } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("applies onAccept=restart as a second event and a second version bump", () => {
    const order = pendingOrder("remake_consent");
    const result = transition(
      makeCtx({
        order,
        role: "customer",
        action: { type: "submitInput", inputId: "in_1", response: { decision: "accept" } },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe("INPUT_SUBMITTED");
    expect(result.events[1].type).toBe("RESTART");
    expect(result.order.stepKey).toBe("orderInProgress_Stage2");
    expect(result.order.version).toBe(order.version + 2);
    expect(result.order.restartCount.orderInProgress_Stage2).toBe(1);
    expect(result.order.inputState.pending).toBe(false);
    expect(result.input?.resolutionApplied).toBe("restart");
  });

  it("applies onDecline=none without touching the FSM", () => {
    const order = pendingOrder("confirm_home");
    const result = transition(
      makeCtx({
        order,
        role: "customer",
        action: { type: "submitInput", inputId: "in_1", response: { decision: "decline" } },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events).toHaveLength(1);
    expect(result.order.stepKey).toBe("orderInProgress_Stage2");
    expect(result.order.version).toBe(order.version + 1);
    expect(result.input?.resolutionApplied).toBe("none");
  });

  it("still enforces the payment gate on auto-resolution", () => {
    const order = makeOrder({
      stepKey: "orderInProgress_Stage3",
      paymentStatus: "unpaid",
      inputState: { pending: true, inputId: "in_1", schemaKey: "confirm_home" },
    });
    const result = transition(
      makeCtx({
        order,
        role: "customer",
        action: { type: "submitInput", inputId: "in_1", response: { decision: "accept" } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PAYMENT_NOT_SETTLED");
  });

  it("requires the customer permission", () => {
    const order = pendingOrder("remake_consent");
    const result = transition(
      makeCtx({
        order,
        role: "kitchen_staff",
        action: { type: "submitInput", inputId: "in_1", response: { decision: "accept" } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORBIDDEN");
  });
});

