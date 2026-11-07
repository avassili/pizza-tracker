/**
 * Step movement: the single implementation of advance / restart / loopback,
 * shared by direct staff actions and by input auto-resolution.
 * See docs/TACTICAL-DESIGN.md §6 and §7.
 */

import { fail } from "../errors";
import type { TenantConfig } from "../config/schema";
import type { MovementKind, Role } from "../rbac/permissions";
import { ulid } from "../ids";
import { assertNotInputPending, assertPaymentSettled } from "./guards";
import {
  STEP_BY_RANK,
  LAST_RANK,
  FIRST_IN_PROGRESS_RANK,
  nextStep,
  prevStep,
  rankOf,
  type StepKey,
} from "./steps";
import type {
  InputResolution,
  OrderEvent,
  OrderEventType,
  OrderSnapshot,
  OrderStatus,
  TimelineEntry,
} from "./types";

const MAX_TIMELINE = 32;

export function pushTimeline(
  timeline: TimelineEntry[],
  stepKey: StepKey,
  enteredAt: string,
  actorRole: string,
): TimelineEntry[] {
  const lastIndex = timeline.length - 1;
  const closed = timeline.map((entry, index) =>
    index === lastIndex && entry.exitedAt === undefined
      ? { ...entry, exitedAt: enteredAt }
      : entry,
  );
  return [...closed, { stepKey, enteredAt, actorRole }].slice(-MAX_TIMELINE);
}

export interface MovementOptions {
  config: TenantConfig;
  actor: { role: Role | "system"; id: string };
  now: string;
  requestId: string;
  /** advance is blocked by an outstanding input request; restarts are not. */
  checkInput: boolean;
  reason?: string;
}

export type MovementResult =
  | { ok: true; order: OrderSnapshot; event: OrderEvent }
  | { ok: false; error: import("../errors").AppError };

export function applyMovement(
  order: OrderSnapshot,
  kind: MovementKind,
  options: MovementOptions,
): MovementResult {
  const { config, actor, now, requestId, checkInput, reason } = options;

  if (checkInput) {
    const pending = assertNotInputPending(order, config);
    if (!pending.ok) return pending;
  }

  const fromStep = order.stepKey;
  let toStep: StepKey;

  if (kind === "advance") {
    const next = nextStep(fromStep);
    if (!next) {
      return fail("INVALID_TRANSITION", `No step follows ${fromStep}`);
    }
    toStep = next;
    if (toStep === "orderComplete") {
      const settled = assertPaymentSettled(order, config);
      if (!settled.ok) return settled;
    }
  } else if (kind === "restart") {
    const rank = rankOf(fromStep);
    if (rank < FIRST_IN_PROGRESS_RANK || rank > LAST_RANK - 1) {
      return fail("INVALID_TRANSITION", `Restart is only allowed on stages 1-3, not ${fromStep}`);
    }
    toStep = fromStep;
  } else {
    const previous = prevStep(fromStep);
    if (!previous) {
      return fail("INVALID_TRANSITION", `Cannot loop back from ${fromStep}`);
    }
    toStep = previous;
  }

  const nextVersion = order.version + 1;
  const toStatus: OrderStatus = toStep === "orderComplete" ? "completed" : "active";
  const fromStatus = order.status;

  const restartCount: Record<string, number> = { ...order.restartCount };
  if (kind === "restart") {
    restartCount[fromStep] = (restartCount[fromStep] ?? 0) + 1;
  }

  const nextOrder: OrderSnapshot = {
    ...order,
    status: toStatus,
    stepKey: toStep,
    stepRank: rankOf(toStep),
    maxStepRank: Math.max(order.maxStepRank, rankOf(toStep)),
    version: nextVersion,
    stepEnteredAt: now,
    updatedAt: now,
    restartCount,
    timeline: pushTimeline(order.timeline, toStep, now, actor.role),
  };

  if (toStatus === "completed") {
    nextOrder.completedAt = now;
  }

  const eventType: OrderEventType =
    kind === "advance" ? "ADVANCE" : kind === "restart" ? "RESTART" : "LOOPBACK";

  const event: OrderEvent = {
    tenantId: order.tenantId,
    orderId: order.orderId,
    eventId: ulid(Date.parse(now)),
    type: eventType,
    fromStep,
    toStep,
    fromStatus,
    toStatus,
    actorRole: actor.role,
    actorId: actor.id,
    orderVersion: nextVersion,
    at: now,
    requestId,
  };
  if (reason) event.reason = reason;

  return { ok: true, order: nextOrder, event };
}

/** Map an input answer onto the resolution the schema declares. */
export function resolutionFor(
  onAccept: InputResolution,
  onDecline: InputResolution,
  decision: "accept" | "decline",
): InputResolution {
  return decision === "accept" ? onAccept : onDecline;
}

/** Exported for the ETA calculation in the read model (§15). */
export function remainingDurations(
  config: TenantConfig,
  fromRank: number,
): number {
  return STEP_BY_RANK.filter((step) => rankOf(step) > fromRank).reduce(
    (total, step) => total + (config.stepDurations[step] ?? 0),
    0,
  );
}
