import { describe, expect, it } from "vitest";
import { makeOrder, NOW } from "@/domain/__fixtures__/order";
import { createOrderSnapshot } from "@/domain/fsm/create";
import {
  configSk,
  eventSk,
  fromOrderEventItem,
  fromOrderItem,
  GSI2SK_ORDER,
  gsi1pkQueue,
  gsi1skStep,
  gsi1skStepPrefix,
  gsi2pkToken,
  inputSk,
  msgSk,
  orderSk,
  PROFILE_SK,
  roleSk,
  tenantPk,
  toOrderEventItem,
  toOrderItem,
} from "./keys";

describe("DynamoDB key builders", () => {
  it("builds canonical PK/SK/GSI key strings", () => {
    expect(tenantPk("acme")).toBe("TENANT#acme");
    expect(orderSk("01J123")).toBe("ORDER#01J123");
    expect(eventSk("01J123", "01J456")).toBe("ORDER#01J123#EVT#01J456");
    expect(inputSk("01J123", "01J789")).toBe("ORDER#01J123#INPUT#01J789");
    expect(msgSk("01J123", "01J999")).toBe("ORDER#01J123#MSG#01J999");
    expect(roleSk("kitchen_staff")).toBe("ROLE#kitchen_staff");
    expect(configSk(1)).toBe("CONFIG#00001");
    expect(PROFILE_SK).toBe("PROFILE");
    expect(gsi1pkQueue("acme", "active")).toBe("TENANT#acme#QUEUE#active");
    expect(gsi1pkQueue("acme", "terminal")).toBe("TENANT#acme#QUEUE#terminal");
    expect(gsi1skStep("orderPlaced", NOW, "01J123")).toBe(
      `STEP#orderPlaced#TS#${NOW}#ORDER#01J123`,
    );
    expect(gsi1skStepPrefix("orderInProgress_Stage1")).toBe("STEP#orderInProgress_Stage1#TS#");
    expect(gsi2pkToken("ABC")).toBe("TOKEN#ABC");
    expect(GSI2SK_ORDER).toBe("ORDER");
  });

  it("maps an active order snapshot to and from a DynamoDB item without leaking keys", () => {
    const order = makeOrder({ status: "active", stepKey: "orderPlaced" });
    const record = toOrderItem(order);

    expect(record.PK).toBe("TENANT#acme");
    expect(record.SK).toBe(`ORDER#${order.orderId}`);
    expect(record.entity).toBe("order");
    expect(record.GSI1PK).toBe("TENANT#acme#QUEUE#active");
    expect(record.GSI1SK).toBe(`STEP#orderPlaced#TS#${order.stepEnteredAt}#ORDER#${order.orderId}`);
    expect(record.GSI2PK).toBe(`TOKEN#${order.publicToken}`);
    expect(record.GSI2SK).toBe("ORDER");

    const roundTripped = fromOrderItem(record as unknown as Record<string, unknown>);
    expect(roundTripped).toEqual(order);
    expect("PK" in roundTripped).toBe(false);
    expect("GSI1PK" in roundTripped).toBe(false);
  });

  it("places completed and cancelled orders in the terminal queue bucket", () => {
    const completed = makeOrder({ status: "completed", stepKey: "orderComplete" });
    const cancelled = makeOrder({ status: "cancelled", stepKey: "orderInProgress_Stage2" });

    expect(toOrderItem(completed).GSI1PK).toBe("TENANT#acme#QUEUE#terminal");
    expect(toOrderItem(cancelled).GSI1PK).toBe("TENANT#acme#QUEUE#terminal");
  });

  it("maps ORDER_PLACED events to and from event items", () => {
    const created = createOrderSnapshot({
      tenantId: "acme",
      configVersion: 1,
      now: NOW,
      actorId: "cust_1",
      customer: { name: "Ada Lovelace" },
      items: [{ name: "Margherita", size: "Large", toppings: ["basil"], qty: 1 }],
      totals: { subtotalCents: 1000, taxCents: 80, totalCents: 1080, currency: "USD" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const evt = created.events[0];
    const record = toOrderEventItem(evt);
    expect(record.PK).toBe("TENANT#acme");
    expect(record.SK).toBe(`ORDER#${evt.orderId}#EVT#${evt.eventId}`);
    expect(record.entity).toBe("orderEvent");

    const roundTripped = fromOrderEventItem(record as unknown as Record<string, unknown>);
    expect(roundTripped).toEqual(evt);
  });
});
