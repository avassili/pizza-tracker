#!/usr/bin/env tsx
/**
 * First-story vertical slice: builds a sample order with the pure domain
 * factory, submits it atomically to DynamoDB (snapshot + ORDER_PLACED event),
 * and reads it back by primary key and GSI2 publicToken.
 */

import { DEFAULT_TENANT_CONFIG } from "../src/domain/config/schema";
import { createOrderSnapshot } from "../src/domain/fsm/create";
import { createDynamoClients } from "../src/infra/dynamodb/client";
import { createDynamoOrderRepository } from "../src/infra/dynamodb/orderRepository";
import { ensurePizzaTrackerTable } from "./init-db";

async function main(): Promise<void> {
  if (!process.env.DYNAMODB_ENDPOINT) {
    process.env.DYNAMODB_ENDPOINT = "http://localhost:8000";
  }

  const { raw, doc, tableName, endpoint } = createDynamoClients();
  await ensurePizzaTrackerTable(raw, tableName);

  const now = new Date().toISOString();
  const created = createOrderSnapshot({
    tenantId: DEFAULT_TENANT_CONFIG.tenantId,
    configVersion: DEFAULT_TENANT_CONFIG.version,
    now,
    actorId: "sample_customer_1",
    customer: {
      name: "Ada Lovelace",
      phone: "+1-555-0101",
      locale: "en",
    },
    items: [
      {
        name: "Margherita",
        size: "Large",
        toppings: ["Basil", "Extra Cheese"],
        qty: 1,
        notes: "Lightly charred crust",
      },
    ],
    totals: {
      subtotalCents: 1800,
      taxCents: 144,
      totalCents: 1944,
      currency: "USD",
    },
    fulfilment: "delivery",
    paymentStatus: "paid",
  });

  if (!created.ok) {
    console.error("Order validation failed:", created.error);
    process.exit(1);
  }

  const repo = createDynamoOrderRepository(doc, tableName);
  const persisted = await repo.createOrder(created.order, created.events);
  if (!persisted.ok) {
    console.error("Failed to submit sample order to DynamoDB:", persisted.error);
    process.exit(1);
  }

  const byKey = await repo.getOrder(created.order.tenantId, created.order.orderId);
  const byToken = await repo.getOrderByPublicToken(created.order.publicToken);
  const events = await repo.listOrderEvents(created.order.tenantId, created.order.orderId);

  console.log("Sample order submitted to DynamoDB:", {
    endpoint,
    tableName,
    orderId: created.order.orderId,
    publicToken: created.order.publicToken,
    status: byKey?.status,
    stepKey: byKey?.stepKey,
    version: byKey?.version,
    foundByPrimaryKey: Boolean(byKey),
    foundByPublicToken: Boolean(byToken),
    eventCount: events.length,
    firstEventType: events[0]?.type,
  });
}

main().catch((err) => {
  console.error("Unexpected error submitting sample order:", err);
  process.exit(1);
});
