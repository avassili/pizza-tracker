"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_TENANT_CONFIG, permissionsFor } from "@/domain/config/schema";
import { fail, type AppError } from "@/domain/errors";
import { createOrderSnapshot } from "@/domain/fsm/create";
import type {
  Fulfilment,
  NotificationIntent,
  OrderItem,
  OrderSnapshot,
  OrderTotals,
  PaymentStatus,
} from "@/domain/fsm/types";
import { can } from "@/domain/rbac/permissions";
import { getSession } from "@/infra/auth/mockSession";
import { createDynamoOrderRepository } from "@/infra/dynamodb/orderRepository";
import { emitNotices } from "@/infra/notifications/consoleChannel";

export interface CreateOrderActionInput {
  customer: { name: string; phone?: string; locale?: string };
  items: OrderItem[];
  totals: OrderTotals;
  fulfilment?: Fulfilment;
  paymentStatus?: PaymentStatus;
}

export type OrderActionResult =
  | { ok: true; order: OrderSnapshot; notices: NotificationIntent[] }
  | { ok: false; error: AppError };

export async function createOrderAction(
  input: CreateOrderActionInput,
): Promise<OrderActionResult> {
  const sessionResult = await getSession();
  if (!sessionResult.ok) {
    return sessionResult;
  }

  const session = sessionResult.data;
  const config = { ...DEFAULT_TENANT_CONFIG, tenantId: session.tenantId };
  const granted = permissionsFor(config, session.role);

  if (!can(granted, "order:create")) {
    return fail("FORBIDDEN", `Role '${session.role}' is missing 'order:create'`, {
      required: "order:create",
    });
  }

  const now = new Date().toISOString();
  const created = createOrderSnapshot({
    tenantId: session.tenantId,
    configVersion: config.version,
    now,
    actorId: session.actorId,
    customer: input.customer,
    items: input.items,
    totals: input.totals,
    fulfilment: input.fulfilment,
    paymentStatus: input.paymentStatus,
  });

  if (!created.ok) {
    return created;
  }

  const repo = createDynamoOrderRepository();
  const persisted = await repo.createOrder(created.order, created.events);
  if (!persisted.ok) {
    return persisted;
  }

  const notices: NotificationIntent[] = [
    {
      kind: "ORDER_PLACED",
      audience: "customer",
      channel: "console",
      orderId: created.order.orderId,
      stepKey: created.order.stepKey,
      message: `Order ${created.order.orderId} received and placed in queue`,
    },
    {
      kind: "ORDER_PLACED",
      audience: "staff",
      channel: "console",
      orderId: created.order.orderId,
      stepKey: created.order.stepKey,
      message: `New order ${created.order.orderId} for ${created.order.customer.name}`,
    },
  ];

  emitNotices(created.events[0]?.requestId ?? `create:${created.order.orderId}`, notices);

  revalidatePath(`/t/${session.tenantId}/track/${created.order.publicToken}`);
  revalidatePath(`/t/${session.tenantId}/queue`);

  return {
    ok: true,
    order: created.order,
    notices,
  };
}
