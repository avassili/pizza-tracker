import { describe, expect, it } from "vitest";
import { createOrderSnapshot } from "@/domain/fsm/create";
import { ensurePizzaTrackerTable } from "../../../scripts/init-db";
import { createDynamoClients } from "./client";
import { createDynamoOrderRepository } from "./orderRepository";

const endpoint = process.env.DYNAMODB_ENDPOINT;
const describeLive = endpoint ? describe : describe.skip;

describeLive("DynamoDB Local order persistence", () => {
  it("creates the table, persists a sample order atomically, and reads it back", async () => {
    const { raw, doc, tableName } = createDynamoClients();
    await ensurePizzaTrackerTable(raw, tableName);

    const created = createOrderSnapshot({
      tenantId: "acme",
      configVersion: 1,
      now: new Date().toISOString(),
      actorId: "integration_test_user",
      customer: { name: "Grace Hopper" },
      items: [{ name: "Pepperoni", size: "Large", toppings: ["Pepperoni"], qty: 1 }],
      totals: { subtotalCents: 1600, taxCents: 128, totalCents: 1728, currency: "USD" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const repo = createDynamoOrderRepository(doc, tableName);
    const saved = await repo.createOrder(created.order, created.events);
    expect(saved.ok).toBe(true);

    // Duplicate write with same orderId/eventId must be rejected by condition expression.
    const dup = await repo.createOrder(created.order, created.events);
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.error.code).toBe("STALE_VERSION");
    }

    const byKey = await repo.getOrder("acme", created.order.orderId);
    const byToken = await repo.getOrderByPublicToken(created.order.publicToken);
    const events = await repo.listOrderEvents("acme", created.order.orderId);

    expect(byKey).toEqual(created.order);
    expect(byToken).toEqual(created.order);
    expect(events).toEqual(created.events);
  });
});
