/**
 * Shared test factory. Not a test file (excluded from the vitest include glob).
 * Keeps every order fixture internally consistent with the FSM invariants.
 */

import { DEFAULT_TENANT_CONFIG, type TenantConfig } from "../config/schema";
import type { OrderAction, OrderSnapshot, TransitionContext } from "../fsm/types";
import { STEP_RANK } from "../fsm/steps";
import type { Role } from "../rbac/permissions";

export const NOW = "2026-10-30T12:00:00.000Z";
export const EARLIER = "2026-10-30T10:00:00.000Z";

export function makeOrder(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  const base: OrderSnapshot = {
    tenantId: "acme",
    orderId: "01JORDERFIXTURE0000000000",
    status: "active",
    stepKey: "orderPlaced",
    stepRank: 0,
    maxStepRank: 0,
    version: 1,
    publicToken: "01JTOKENFIXTURE00000000000",
    configVersion: 1,
    customer: { name: "Ada Lovelace" },
    items: [{ name: "Margherita", size: "Large", toppings: ["basil"], qty: 1 }],
    totals: { subtotalCents: 1200, taxCents: 108, totalCents: 1308, currency: "USD" },
    paymentStatus: "paid",
    fulfilment: "delivery",
    inputState: { pending: false },
    restartCount: {},
    timeline: [{ stepKey: "orderPlaced", enteredAt: EARLIER, actorRole: "customer" }],
    stepEnteredAt: EARLIER,
    createdBy: { role: "customer", id: "cust_1" },
    createdAt: EARLIER,
    updatedAt: EARLIER,
  };

  const merged: OrderSnapshot = { ...base, ...overrides };
  merged.stepRank = STEP_RANK[merged.stepKey];
  merged.maxStepRank = Math.max(merged.maxStepRank, merged.stepRank);

  // Keep status/stepKey consistent unless the caller forced a status.
  if (merged.stepKey === "orderComplete" && overrides.status === undefined) {
    merged.status = "completed";
  }

  return merged;
}

export interface MakeCtxArgs {
  order: OrderSnapshot;
  action: OrderAction;
  role?: Role;
  actorId?: string;
  now?: string;
  config?: TenantConfig;
}

export function makeCtx(args: MakeCtxArgs): TransitionContext {
  return {
    actor: { role: args.role ?? "kitchen_staff", id: args.actorId ?? "staff_1" },
    now: args.now ?? NOW,
    requestId: "req_test",
    config: args.config ?? DEFAULT_TENANT_CONFIG,
    order: args.order,
    action: args.action,
  };
}
