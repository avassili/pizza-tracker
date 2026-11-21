/**
 * Single source of truth for DynamoDB single-table keys and item projections.
 * See docs/TACTICAL-DESIGN.md §3 and §4.
 *
 * No key string literals should exist outside this module.
 */

import { queueBucket } from "@/domain/fsm/selectors";
import type { StepKey } from "@/domain/fsm/steps";
import type { OrderEvent, OrderSnapshot } from "@/domain/fsm/types";

export const PROFILE_SK = "PROFILE";
export const GSI2SK_ORDER = "ORDER";

export const tenantPk = (tenantId: string) => `TENANT#${tenantId}`;
export const orderSk = (orderId: string) => `ORDER#${orderId}`;
export const eventSk = (orderId: string, eventUlid: string) =>
  `ORDER#${orderId}#EVT#${eventUlid}`;
export const eventSkPrefix = (orderId: string) => `ORDER#${orderId}#EVT#`;
export const inputSk = (orderId: string, inputId: string) =>
  `ORDER#${orderId}#INPUT#${inputId}`;
export const msgSk = (orderId: string, msgUlid: string) =>
  `ORDER#${orderId}#MSG#${msgUlid}`;
export const roleSk = (roleId: string) => `ROLE#${roleId}`;
export const configSk = (version: number) =>
  `CONFIG#${String(version).padStart(5, "0")}`;

export const gsi1pkQueue = (tenantId: string, bucket: "active" | "terminal") =>
  `TENANT#${tenantId}#QUEUE#${bucket}`;

export const gsi1skStep = (step: StepKey, enteredAt: string, orderId: string) =>
  `STEP#${step}#TS#${enteredAt}#ORDER#${orderId}`;

export const gsi1skStepPrefix = (step: StepKey) => `STEP#${step}#TS#`;

export const gsi2pkToken = (token: string) => `TOKEN#${token}`;

export interface OrderRecord extends OrderSnapshot {
  PK: string;
  SK: string;
  entity: "order";
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
}

export interface OrderEventRecord extends OrderEvent {
  PK: string;
  SK: string;
  entity: "orderEvent";
}

export function toOrderItem(order: OrderSnapshot): OrderRecord {
  const bucket = queueBucket(order);
  return {
    ...order,
    PK: tenantPk(order.tenantId),
    SK: orderSk(order.orderId),
    entity: "order",
    GSI1PK: gsi1pkQueue(order.tenantId, bucket),
    GSI1SK: gsi1skStep(order.stepKey, order.stepEnteredAt, order.orderId),
    GSI2PK: gsi2pkToken(order.publicToken),
    GSI2SK: GSI2SK_ORDER,
  };
}

export function fromOrderItem(item: Record<string, unknown>): OrderSnapshot {
  const {
    PK: _pk,
    SK: _sk,
    entity: _entity,
    GSI1PK: _gsi1pk,
    GSI1SK: _gsi1sk,
    GSI2PK: _gsi2pk,
    GSI2SK: _gsi2sk,
    ...snapshot
  } = item;
  void _pk;
  void _sk;
  void _entity;
  void _gsi1pk;
  void _gsi1sk;
  void _gsi2pk;
  void _gsi2sk;
  return snapshot as unknown as OrderSnapshot;
}

export function toOrderEventItem(event: OrderEvent): OrderEventRecord {
  return {
    ...event,
    PK: tenantPk(event.tenantId),
    SK: eventSk(event.orderId, event.eventId),
    entity: "orderEvent",
  };
}

export function fromOrderEventItem(item: Record<string, unknown>): OrderEvent {
  const { PK: _pk, SK: _sk, entity: _entity, ...event } = item;
  void _pk;
  void _sk;
  void _entity;
  return event as unknown as OrderEvent;
}
