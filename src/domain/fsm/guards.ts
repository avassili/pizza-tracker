import { fail, ok, type Result } from "../errors";
import type { TenantConfig } from "../config/schema";
import type { OrderSnapshot } from "./types";

/** Terminal-state guard. Runs before permission so a dead order never leaks role info. */
export function assertActive(order: OrderSnapshot): Result<void> {
  if (order.status !== "active") {
    return fail("TERMINAL_STATE", `Order ${order.orderId} is already ${order.status}`, {
      status: order.status,
      stepKey: order.stepKey,
    });
  }
  return ok(undefined);
}

/**
 * Blocks step movement while a customer decision is outstanding, unless the
 * tenant explicitly allows parallel work (inventory shortage, for example).
 */
export function assertNotInputPending(
  order: OrderSnapshot,
  config: TenantConfig,
): Result<void> {
  if (!order.inputState.pending) return ok(undefined);
  if (config.businessRules.allowAdvanceWhileAwaitingInput) return ok(undefined);
  return fail(
    "INPUT_PENDING",
    "A customer response is outstanding; movement is locked until it is submitted",
    {
      inputId: order.inputState.inputId,
      schemaKey: order.inputState.schemaKey,
      requestedAt: order.inputState.requestedAt,
    },
  );
}

/** Completion gate: orderComplete requires settled payment when the tenant asks for it. */
export function assertPaymentSettled(
  order: OrderSnapshot,
  config: TenantConfig,
): Result<void> {
  if (!config.businessRules.requirePaymentSettledToComplete) return ok(undefined);
  if (order.paymentStatus === "paid") return ok(undefined);
  return fail(
    "PAYMENT_NOT_SETTLED",
    "Order cannot be completed until payment is settled",
    { paymentStatus: order.paymentStatus },
  );
}
