import { describe, expect, it, vi } from "vitest";
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { NOW } from "@/domain/__fixtures__/order";
import { createOrderSnapshot } from "@/domain/fsm/create";
import { createDynamoOrderRepository } from "./orderRepository";
import { toOrderEventItem, toOrderItem } from "./keys";

function makeSample() {
  const res = createOrderSnapshot({
    tenantId: "acme",
    configVersion: 1,
    now: NOW,
    actorId: "cust_1",
    customer: { name: "Ada Lovelace" },
    items: [{ name: "Margherita", size: "Large", toppings: ["basil"], qty: 1 }],
    totals: { subtotalCents: 1200, taxCents: 96, totalCents: 1296, currency: "USD" },
    orderId: "01JORDER000000000000000001",
    token: "01JTOKEN000000000000000001",
  });
  if (!res.ok) throw new Error("expected valid sample");
  return res;
}

describe("createDynamoOrderRepository", () => {
  it("writes the order snapshot and ORDER_PLACED event in one TransactWriteCommand", async () => {
    const send = vi.fn().mockResolvedValue({});
    const mockDoc = { send } as unknown as DynamoDBDocumentClient;
    const repo = createDynamoOrderRepository(mockDoc, "PizzaTrackerDev");
    const { order, events } = makeSample();

    const result = await repo.createOrder(order, events);

    expect(result.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(TransactWriteCommand);
    expect(cmd.input.TransactItems).toHaveLength(2);
    expect(cmd.input.TransactItems?.[0].Put?.ConditionExpression).toBe("attribute_not_exists(PK)");
    expect(cmd.input.TransactItems?.[0].Put?.Item?.PK).toBe("TENANT#acme");
    expect(cmd.input.TransactItems?.[0].Put?.Item?.SK).toBe(`ORDER#${order.orderId}`);
    expect(cmd.input.TransactItems?.[1].Put?.Item?.SK).toBe(
      `ORDER#${order.orderId}#EVT#${events[0].eventId}`,
    );
  });

  it("maps TransactionCanceledException to STALE_VERSION", async () => {
    const err = new Error("Transaction cancelled");
    err.name = "TransactionCanceledException";
    const send = vi.fn().mockRejectedValue(err);
    const mockDoc = { send } as unknown as DynamoDBDocumentClient;
    const repo = createDynamoOrderRepository(mockDoc, "PizzaTrackerDev");
    const { order, events } = makeSample();

    const result = await repo.createOrder(order, events);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STALE_VERSION");
  });

  it("maps ProvisionedThroughputExceededException to RATE_LIMITED", async () => {
    const err = new Error("Throttled");
    err.name = "ProvisionedThroughputExceededException";
    const send = vi.fn().mockRejectedValue(err);
    const mockDoc = { send } as unknown as DynamoDBDocumentClient;
    const repo = createDynamoOrderRepository(mockDoc, "PizzaTrackerDev");
    const { order, events } = makeSample();

    const result = await repo.createOrder(order, events);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RATE_LIMITED");
  });

  it("reads an order by primary key and by GSI2 public token", async () => {
    const { order, events } = makeSample();
    const orderRecord = toOrderItem(order);
    const eventRecord = toOrderEventItem(events[0]);

    const send = vi.fn().mockImplementation((cmd: unknown) => {
      if (cmd instanceof GetCommand) {
        return Promise.resolve({ Item: orderRecord });
      }
      if (cmd instanceof QueryCommand && cmd.input.IndexName === "GSI2") {
        return Promise.resolve({ Items: [orderRecord] });
      }
      if (cmd instanceof QueryCommand) {
        return Promise.resolve({ Items: [eventRecord] });
      }
      return Promise.resolve({});
    });
    const mockDoc = { send } as unknown as DynamoDBDocumentClient;
    const repo = createDynamoOrderRepository(mockDoc, "PizzaTrackerDev");

    const byKey = await repo.getOrder("acme", order.orderId);
    const byToken = await repo.getOrderByPublicToken(order.publicToken);
    const loadedEvents = await repo.listOrderEvents("acme", order.orderId);

    expect(byKey).toEqual(order);
    expect(byToken).toEqual(order);
    expect(loadedEvents).toEqual(events);
  });

  it("returns null when an order or public token is not found", async () => {
    const send = vi.fn().mockResolvedValue({ Items: [] });
    const mockDoc = { send } as unknown as DynamoDBDocumentClient;
    const repo = createDynamoOrderRepository(mockDoc, "PizzaTrackerDev");

    expect(await repo.getOrder("acme", "MISSING")).toBeNull();
    expect(await repo.getOrderByPublicToken("MISSING")).toBeNull();
  });
});
