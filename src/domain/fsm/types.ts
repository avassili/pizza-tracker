import type { Role } from "../rbac/permissions";
import type { StepKey } from "./steps";

export type OrderStatus = "active" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "authorized" | "paid" | "refunded";
export type Fulfilment = "delivery" | "pickup";
export type InputResolution = "advance" | "restart" | "loopback" | "none";

export interface OrderItem {
  name: string;
  size: string;
  toppings: string[];
  qty: number;
  notes?: string;
}

export interface OrderTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
}

export interface InputState {
  pending: boolean;
  inputId?: string;
  schemaKey?: string;
  requestedAt?: string;
  requestedBy?: string;
}

export interface TimelineEntry {
  stepKey: StepKey;
  enteredAt: string;
  exitedAt?: string;
  actorRole: string;
}

/**
 * The persisted order projection. GSI keys and the `entity` discriminator are
 * added by src/infra/dynamodb/keys.ts — the domain never knows about indexes.
 */
export interface OrderSnapshot {
  tenantId: string;
  orderId: string;
  status: OrderStatus;
  stepKey: StepKey;
  stepRank: number;
  maxStepRank: number;
  version: number;
  publicToken: string;
  configVersion: number;
  customer: { name: string; phone?: string; locale?: string };
  items: OrderItem[];
  totals: OrderTotals;
  paymentStatus: PaymentStatus;
  fulfilment: Fulfilment;
  inputState: InputState;
  restartCount: Record<string, number>;
  timeline: TimelineEntry[];
  stepEnteredAt: string;
  createdBy: { role: string; id: string };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  cancelledAtStep?: StepKey;
  cancelReason?: string;
}

export type OrderEventType =
  | "ORDER_PLACED"
  | "ADVANCE"
  | "RESTART"
  | "LOOPBACK"
  | "CANCEL"
  | "INPUT_REQUESTED"
  | "INPUT_SUBMITTED";

export interface OrderEvent {
  tenantId: string;
  orderId: string;
  eventId: string;
  type: OrderEventType;
  fromStep: StepKey;
  toStep: StepKey;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  actorRole: Role | "system";
  actorId: string;
  orderVersion: number;
  at: string;
  requestId: string;
  reason?: string;
  resolution?: InputResolution;
  metadata?: Record<string, unknown>;
}

export interface OrderInputItem {
  tenantId: string;
  orderId: string;
  inputId: string;
  schemaKey: string;
  status: "pending" | "submitted" | "expired";
  requestedBy: string;
  requestedAt: string;
  response?: Record<string, unknown>;
  submittedAt?: string;
  resolutionApplied?: InputResolution;
}

export type InputDirection = "customer_to_store" | "store_to_customer";

export interface OrderMessage {
  tenantId: string;
  orderId: string;
  messageId: string;
  direction: InputDirection;
  stepKey: StepKey;
  visibility: "customer_visible" | "internal";
  body: string;
  authorRole: Role;
  authorId: string;
  at: string;
  readAt?: string;
}

export type OrderAction =
  | { type: "advance" }
  | { type: "restart"; reason?: string }
  | { type: "loopback"; reason?: string }
  | { type: "cancel"; reason: string }
  | { type: "requestInput"; schemaKey: string }
  | { type: "submitInput"; inputId: string; response: Record<string, unknown> };

export type NotificationKind =
  | "ORDER_PLACED"
  | "STEP_CHANGED"
  | "ORDER_COMPLETED"
  | "ORDER_RESTARTED"
  | "ORDER_LOOPBACKED"
  | "ORDER_CANCELLED"
  | "INPUT_REQUESTED"
  | "INPUT_SUBMITTED"
  | "INPUT_RESOLVED";

/** Copied verbatim into the console notification driver's stdout payload. */
export interface NotificationIntent {
  kind: NotificationKind;
  audience: "customer" | "staff";
  channel: "console";
  orderId: string;
  stepKey: StepKey;
  message: string;
}

export interface TransitionContext {
  /** Who is acting. Never taken from client arguments — see §13.1. */
  actor: { role: Role; id: string };
  /** Injected ISO-8601 timestamp; the reducer never reads the wall clock. */
  now: string;
  requestId: string;
  config: import("../config/schema").TenantConfig;
  order: OrderSnapshot;
  action: OrderAction;
}

export type TransitionResult =
  | {
      ok: true;
      order: OrderSnapshot;
      events: OrderEvent[];
      input?: OrderInputItem;
      notices: NotificationIntent[];
    }
  | { ok: false; error: import("../errors").AppError };
