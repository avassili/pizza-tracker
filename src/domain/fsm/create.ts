/**
 * Pure order creation: validation plus identity minting.
 * Persistence happens elsewhere — this only builds the v1 snapshot.
 */

import { fail } from "../errors";
import { publicToken, ulid } from "../ids";
import { rankOf } from "./steps";
import type {
  Fulfilment,
  OrderEvent,
  OrderItem,
  OrderSnapshot,
  OrderTotals,
  PaymentStatus,
} from "./types";

export interface CreateOrderParams {
  tenantId: string;
  configVersion: number;
  now: string;
  actorId: string;
  customer: { name: string; phone?: string; locale?: string };
  items: OrderItem[];
  totals: OrderTotals;
  fulfilment?: Fulfilment;
  paymentStatus?: PaymentStatus;
  /** Test seam: deterministic ids. */
  orderId?: string;
  token?: string;
}

export type CreateOrderResult =
  | { ok: true; order: OrderSnapshot; events: OrderEvent[] }
  | { ok: false; error: import("../errors").AppError };

export function createOrderSnapshot(params: CreateOrderParams): CreateOrderResult {
  const {
    tenantId,
    configVersion,
    now,
    actorId,
    customer,
    items,
    totals,
    fulfilment = "delivery",
    paymentStatus = "unpaid",
    orderId,
    token,
  } = params;

  if (!tenantId.trim()) {
    return fail("VALIDATION_FAILED", "tenantId is required", { field: "tenantId" });
  }
  if (!customer?.name?.trim()) {
    return fail("VALIDATION_FAILED", "Customer name is required", { field: "customer.name" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return fail("VALIDATION_FAILED", "An order needs at least one item", { field: "items" });
  }
  for (const item of items) {
    if (!item.name?.trim()) {
      return fail("VALIDATION_FAILED", "Every item needs a name", { field: "items[].name" });
    }
    if (!Number.isInteger(item.qty) || item.qty < 1) {
      return fail("VALIDATION_FAILED", "Item quantity must be an integer >= 1", {
        field: "items[].qty",
      });
    }
  }
  for (const key of ["subtotalCents", "taxCents", "totalCents"] as const) {
    const value = totals?.[key];
    if (!Number.isInteger(value) || value < 0) {
      return fail("VALIDATION_FAILED", `${key} must be a non-negative integer`, {
        field: `totals.${key}`,
      });
    }
  }
  if (!totals.currency?.trim()) {
    return fail("VALIDATION_FAILED", "totals.currency is required", { field: "totals.currency" });
  }

  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    return fail("VALIDATION_FAILED", "now must be an ISO-8601 timestamp", { field: "now" });
  }

  const id = orderId ?? ulid(nowMs);
  const created: OrderSnapshot = {
    tenantId,
    orderId: id,
    status: "active",
    stepKey: "orderPlaced",
    stepRank: rankOf("orderPlaced"),
    maxStepRank: rankOf("orderPlaced"),
    version: 1,
    publicToken: token ?? publicToken(),
    configVersion,
    customer: {
      name: customer.name.trim(),
      ...(customer.phone ? { phone: customer.phone } : {}),
      ...(customer.locale ? { locale: customer.locale } : {}),
    },
    items,
    totals,
    paymentStatus,
    fulfilment,
    inputState: { pending: false },
    restartCount: {},
    timeline: [{ stepKey: "orderPlaced", enteredAt: now, actorRole: "customer" }],
    stepEnteredAt: now,
    createdBy: { role: "customer", id: actorId },
    createdAt: now,
    updatedAt: now,
  };

  const event: OrderEvent = {
    tenantId,
    orderId: id,
    eventId: ulid(nowMs),
    type: "ORDER_PLACED",
    fromStep: "orderPlaced",
    toStep: "orderPlaced",
    fromStatus: "active",
    toStatus: "active",
    actorRole: "customer",
    actorId,
    orderVersion: 1,
    at: now,
    requestId: `create:${id}`,
  };

  return { ok: true, order: created, events: [event] };
}
