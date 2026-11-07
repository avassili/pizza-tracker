/**
 * The pure FSM reducer. Synchronous, clock-injected, side-effect free.
 * See docs/TACTICAL-DESIGN.md §7 (table), §8 (guard order) and §11.
 */

import { fail, type Failure } from "../errors";
import { ulid } from "../ids";
import { can, type MovementKind } from "../rbac/permissions";
import { assertActive } from "./guards";
import { applyMovement, resolutionFor } from "./resolve";
import type { StepKey } from "./steps";
import {
  FIRST_IN_PROGRESS_RANK,
  LAST_RANK,
  nextStep,
  prevStep,
  rankOf,
} from "./steps";
import type {
  NotificationIntent,
  OrderAction,
  OrderEvent,
  OrderInputItem,
  OrderSnapshot,
  TransitionContext,
  TransitionResult,
} from "./types";

export function transition(ctx: TransitionContext): TransitionResult {
  const { order, action, config, actor } = ctx;

  // 1. VALIDATION
  const invalid = validate(action, config);
  if (invalid) return invalid;

  // 2. UNAUTHENTICATED — an unknown role must never be treated as "no rules".
  const granted = config.rolePermissions[actor.role];
  if (!granted || granted.length === 0) {
    return fail("UNAUTHENTICATED", `Role '${actor.role}' is not configured for this tenant`, {
      role: actor.role,
    });
  }

  // 3. TERMINAL_STATE (NOT_FOUND is a repository concern; the order is given).
  const active = assertActive(order);
  if (!active.ok) return active;

  // 4. STRUCTURAL FEASIBILITY — a move that cannot exist is a client error, not
  // an authorisation one, so it is reported before FORBIDDEN. It leaks nothing:
  // the current step is already visible to anyone who can name the order.
  const structural = assertMovable(order, action);
  if (structural) return structural;

  // 5. PERMISSION
  const required = requiredPermission(action, order.stepKey);
  if (!can(granted, required)) {
    return fail("FORBIDDEN", `Role '${actor.role}' is missing '${required}'`, { required });
  }

  // 6. Domain guards + state computation.
  switch (action.type) {
    case "advance":
      return movement(order, "advance", ctx);

    case "restart":
      return movement(order, "restart", ctx, action.reason);

    case "loopback":
      return movement(order, "loopback", ctx, action.reason);

    case "cancel":
      return cancel(order, ctx, action.reason);

    case "requestInput":
      return requestInput(order, ctx, action.schemaKey);

    case "submitInput":
      return submitInput(order, ctx, action.inputId, action.response);
  }
}

function validate(action: OrderAction, config: TransitionContext["config"]): Failure | null {
  switch (action.type) {
    case "cancel": {
      const reason = typeof action.reason === "string" ? action.reason.trim() : "";
      if (reason.length < 3) {
        return fail("VALIDATION_FAILED", "A cancellation reason of at least 3 characters is required", {
          field: "reason",
        });
      }
      return null;
    }
    case "requestInput": {
      if (!action.schemaKey || !config.inputSchemas[action.schemaKey]) {
        return fail("VALIDATION_FAILED", `Unknown input schema '${action.schemaKey}'`, {
          field: "schemaKey",
        });
      }
      return null;
    }
    case "submitInput": {
      if (!action.inputId) {
        return fail("VALIDATION_FAILED", "inputId is required", { field: "inputId" });
      }
      const decision = action.response?.decision;
      if (decision !== "accept" && decision !== "decline") {
        return fail("VALIDATION_FAILED", "response.decision must be 'accept' or 'decline'", {
          field: "response.decision",
        });
      }
      return null;
    }
    default:
      return null;
  }
}

function assertMovable(order: OrderSnapshot, action: OrderAction): Failure | null {
  switch (action.type) {
    case "advance":
      return nextStep(order.stepKey) === null
        ? fail("INVALID_TRANSITION", `No step follows ${order.stepKey}`)
        : null;
    case "restart": {
      const rank = rankOf(order.stepKey);
      return rank < FIRST_IN_PROGRESS_RANK || rank > LAST_RANK - 1
        ? fail(
            "INVALID_TRANSITION",
            `Restart is only allowed on stages 1-3, not ${order.stepKey}`,
          )
        : null;
    }
    case "loopback":
      return prevStep(order.stepKey) === null
        ? fail("INVALID_TRANSITION", `Cannot loop back from ${order.stepKey}`)
        : null;
    default:
      return null;
  }
}

function requiredPermission(action: OrderAction, stepKey: StepKey): string {
  switch (action.type) {
    case "advance":
      return `step:advance:${stepKey}`;
    case "restart":
      return `step:restart:${stepKey}`;
    case "loopback":
      return `step:loopback:${stepKey}`;
    case "cancel":
      return "order:cancel";
    case "requestInput":
      return "input:request";
    case "submitInput":
      return "input:submit";
  }
}

function movement(
  order: OrderSnapshot,
  kind: MovementKind,
  ctx: TransitionContext,
  reason?: string,
): TransitionResult {
  const moved = applyMovement(order, kind, {
    config: ctx.config,
    actor: ctx.actor,
    now: ctx.now,
    requestId: ctx.requestId,
    checkInput: kind === "advance",
    reason,
  });
  if (!moved.ok) return moved;
  return {
    ok: true,
    order: moved.order,
    events: [moved.event],
    notices: [movementNotice(kind, moved.order)],
  };
}

function movementNotice(kind: MovementKind, order: OrderSnapshot): NotificationIntent {
  const base = {
    audience: "customer" as const,
    channel: "console" as const,
    orderId: order.orderId,
    stepKey: order.stepKey,
  };
  switch (kind) {
    case "advance":
      return order.stepKey === "orderComplete"
        ? { ...base, kind: "ORDER_COMPLETED", message: "Your order is complete" }
        : { ...base, kind: "STEP_CHANGED", message: `Your order moved to ${order.stepKey}` };
    case "restart":
      return { ...base, kind: "ORDER_RESTARTED", message: `We restarted ${order.stepKey}` };
    case "loopback":
      return {
        ...base,
        kind: "ORDER_LOOPBACKED",
        message: `We sent the order back to ${order.stepKey}`,
      };
  }
}

function cancel(order: OrderSnapshot, ctx: TransitionContext, reason: string): TransitionResult {
  const nextVersion = order.version + 1;
  const cleanReason = reason.trim();
  const nextOrder: OrderSnapshot = {
    ...order,
    status: "cancelled",
    version: nextVersion,
    updatedAt: ctx.now,
    cancelledAt: ctx.now,
    cancelledAtStep: order.stepKey,
    cancelReason: cleanReason,
    inputState: { pending: false },
  };
  const event: OrderEvent = {
    tenantId: order.tenantId,
    orderId: order.orderId,
    eventId: ulid(Date.parse(ctx.now)),
    type: "CANCEL",
    fromStep: order.stepKey,
    toStep: order.stepKey,
    fromStatus: order.status,
    toStatus: "cancelled",
    actorRole: ctx.actor.role,
    actorId: ctx.actor.id,
    orderVersion: nextVersion,
    at: ctx.now,
    requestId: ctx.requestId,
    reason: cleanReason,
  };
  return {
    ok: true,
    order: nextOrder,
    events: [event],
    notices: [
      {
        kind: "ORDER_CANCELLED",
        audience: "customer",
        channel: "console",
        orderId: order.orderId,
        stepKey: order.stepKey,
        message: `Order cancelled: ${cleanReason}`,
      },
    ],
  };
}

function requestInput(
  order: OrderSnapshot,
  ctx: TransitionContext,
  schemaKey: string,
): TransitionResult {
  if (order.inputState.pending) {
    return fail("INPUT_PENDING", "An input request is already outstanding", {
      inputId: order.inputState.inputId,
    });
  }

  const nowMs = Date.parse(ctx.now);
  const inputId = ulid(nowMs);
  const nextVersion = order.version + 1;

  const input: OrderInputItem = {
    tenantId: order.tenantId,
    orderId: order.orderId,
    inputId,
    schemaKey,
    status: "pending",
    requestedBy: ctx.actor.id,
    requestedAt: ctx.now,
  };

  const nextOrder: OrderSnapshot = {
    ...order,
    version: nextVersion,
    updatedAt: ctx.now,
    inputState: {
      pending: true,
      inputId,
      schemaKey,
      requestedAt: ctx.now,
      requestedBy: ctx.actor.id,
    },
  };

  const event: OrderEvent = {
    tenantId: order.tenantId,
    orderId: order.orderId,
    eventId: ulid(nowMs),
    type: "INPUT_REQUESTED",
    fromStep: order.stepKey,
    toStep: order.stepKey,
    fromStatus: order.status,
    toStatus: order.status,
    actorRole: ctx.actor.role,
    actorId: ctx.actor.id,
    orderVersion: nextVersion,
    at: ctx.now,
    requestId: ctx.requestId,
    metadata: { schemaKey },
  };

  return {
    ok: true,
    order: nextOrder,
    events: [event],
    input,
    notices: [
      {
        kind: "INPUT_REQUESTED",
        audience: "customer",
        channel: "console",
        orderId: order.orderId,
        stepKey: order.stepKey,
        message: `We need your input: ${schemaKey}`,
      },
    ],
  };
}

function submitInput(
  order: OrderSnapshot,
  ctx: TransitionContext,
  inputId: string,
  response: Record<string, unknown>,
): TransitionResult {
  const { pending, inputId: pendingId, schemaKey, requestedBy, requestedAt } = order.inputState;

  if (!pending) {
    return fail("INPUT_NOT_PENDING", "There is no outstanding input request for this order");
  }
  if (!pendingId || pendingId !== inputId) {
    return fail("VALIDATION_FAILED", "inputId does not match the pending request", {
      expected: pendingId,
      received: inputId,
    });
  }

  const schema = schemaKey ? ctx.config.inputSchemas[schemaKey] : undefined;
  if (!schema) {
    return fail("VALIDATION_FAILED", `Order references unknown input schema '${schemaKey}'`, {
      field: "inputState.schemaKey",
    });
  }

  const decision = response.decision === "decline" ? "decline" : "accept";
  const resolution = resolutionFor(
    schema.resolution.onAccept,
    schema.resolution.onDecline,
    decision,
  );

  const nowMs = Date.parse(ctx.now);
  const submittedVersion = order.version + 1;
  const submitted: OrderSnapshot = {
    ...order,
    version: submittedVersion,
    updatedAt: ctx.now,
    inputState: { pending: false },
  };

  const input: OrderInputItem = {
    tenantId: order.tenantId,
    orderId: order.orderId,
    inputId,
    schemaKey: schema.schemaKey,
    status: "submitted",
    requestedBy: requestedBy ?? ctx.actor.id,
    requestedAt: requestedAt ?? ctx.now,
    response,
    submittedAt: ctx.now,
    resolutionApplied: resolution,
  };

  const submittedEvent: OrderEvent = {
    tenantId: order.tenantId,
    orderId: order.orderId,
    eventId: ulid(nowMs),
    type: "INPUT_SUBMITTED",
    fromStep: order.stepKey,
    toStep: order.stepKey,
    fromStatus: order.status,
    toStatus: order.status,
    actorRole: ctx.actor.role,
    actorId: ctx.actor.id,
    orderVersion: submittedVersion,
    at: ctx.now,
    requestId: ctx.requestId,
    resolution,
    metadata: { schemaKey: schema.schemaKey, decision },
  };

  const notices: NotificationIntent[] = [
    {
      kind: "INPUT_SUBMITTED",
      audience: "staff",
      channel: "console",
      orderId: order.orderId,
      stepKey: order.stepKey,
      message: `Customer answered ${schema.schemaKey}: ${decision}`,
    },
  ];

  if (resolution === "none") {
    return { ok: true, order: submitted, events: [submittedEvent], input, notices };
  }

  // Auto-resolution runs as the system: permission is NOT re-checked (the answer
  // already authorised it), but the payment and terminal guards still apply.
  const moved = applyMovement(submitted, resolution, {
    config: ctx.config,
    actor: { role: "system", id: ctx.actor.id },
    now: ctx.now,
    requestId: ctx.requestId,
    checkInput: true,
  });
  if (!moved.ok) return moved;

  moved.event.resolution = resolution;
  moved.event.metadata = { ...moved.event.metadata, triggeredBy: "INPUT_SUBMITTED" };
  notices.push(movementNotice(resolution, moved.order));

  return {
    ok: true,
    order: moved.order,
    events: [submittedEvent, moved.event],
    input,
    notices,
  };
}



