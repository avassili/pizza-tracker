/**
 * Pure read-model selectors. No I/O, no clock reads — `now` is always injected.
 * See docs/TACTICAL-DESIGN.md §15.
 */

import type { TenantConfig } from "../config/schema";
import { STEP_BY_RANK, rankOf } from "./steps";
import type { OrderSnapshot } from "./types";

export type QueueBucket = "active" | "terminal";

/**
 * Every order sits in exactly one queue bucket at all times. Terminal orders
 * leave the hot partition so the board query stays inside 5 RCU.
 */
export function queueBucket(order: OrderSnapshot): QueueBucket {
  return order.status === "active" ? "active" : "terminal";
}

/** True when a loopback walked the order backwards from its high-water mark. */
export function isRecheck(order: OrderSnapshot): boolean {
  return order.stepRank < order.maxStepRank;
}

export interface Eta {
  etaIso: string | null;
  etaMinutes: number | null;
}

const MAX_ETA_SECONDS = 4 * 60 * 60;

/**
 * ETA = the remaining per-step durations from config, minus time already spent
 * in the current step. Restarts and loopbacks push it out for free because
 * `stepEnteredAt` is rewritten on every movement.
 */
export function etaFor(
  config: TenantConfig,
  order: OrderSnapshot,
  nowMs: number,
): Eta {
  if (order.status !== "active") {
    return { etaIso: null, etaMinutes: null };
  }

  const remaining = STEP_BY_RANK.filter((step) => rankOf(step) > order.stepRank).reduce(
    (total, step) => total + (config.stepDurations[step] ?? 0),
    0,
  );

  const enteredMs = Date.parse(order.stepEnteredAt);
  const elapsedSeconds = Number.isNaN(enteredMs)
    ? 0
    : Math.max(0, (nowMs - enteredMs) / 1000);
  const currentLeft = Math.max(
    0,
    (config.stepDurations[order.stepKey] ?? 0) - elapsedSeconds,
  );

  const totalSeconds = Math.min(Math.max(0, remaining + currentLeft), MAX_ETA_SECONDS);

  return {
    etaIso: new Date(nowMs + totalSeconds * 1000).toISOString(),
    etaMinutes: Math.round(totalSeconds / 60),
  };
}
