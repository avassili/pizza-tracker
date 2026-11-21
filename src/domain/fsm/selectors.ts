/**
 * Pure read-model selectors. No I/O, no clock reads — `now` is always injected.
 * See docs/TACTICAL-DESIGN.md §15.
 */

import { translate, type TenantConfig } from "../config/schema";
import { STEP_BY_RANK, STEP_KEYS, rankOf, type StepKey } from "./steps";
import type { OrderSnapshot, OrderStatus } from "./types";

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

export type MilestoneState = "done" | "current" | "upcoming" | "skipped";

export interface TrackerMilestone {
  stepKey: StepKey;
  label: string;
  detail: string;
  icon: string;
  state: MilestoneState;
}

export interface TrackerViewModel {
  tenant: { displayName: string; primaryColor: string; logoUrl?: string; locale: string };
  order: { publicToken: string; status: OrderStatus; placedAt: string };
  /** Exactly five entries, always, in rank order — the UI never branches on count. */
  milestones: TrackerMilestone[];
  currentStepKey: StepKey;
  maxStepRank: number;
  recheck: boolean;
  etaIso: string | null;
  etaMinutes: number | null;
  pendingInput: {
    inputId: string;
    schemaKey: string;
    prompt: string;
    options: { value: string; label: string }[];
    freeText: boolean;
  } | null;
  cancelled: { at: string; reason: string } | null;
  version: number;
}

function milestoneStateFor(order: OrderSnapshot, rank: number): MilestoneState {
  if (order.status === "completed") {
    return "done";
  }
  if (rank === order.stepRank) {
    return "current";
  }
  if (rank < order.stepRank || rank <= order.maxStepRank) {
    return "done";
  }
  return "upcoming";
}

/**
 * Whitelist mapper for the customer tracker view. Never spreads the persisted
 * item so internal fields (restartCount, actorId, GSI*, notes) cannot leak.
 */
export function toTrackerViewModel(
  config: TenantConfig,
  order: OrderSnapshot,
  nowMs: number,
  localeOverride?: string,
): TrackerViewModel {
  const requestedLocale = localeOverride ?? order.customer.locale ?? config.defaultLocale;
  const locale = config.i18n[requestedLocale] ? requestedLocale : config.defaultLocale;

  const milestones: TrackerMilestone[] = STEP_KEYS.map((stepKey, rank) => {
    const pres = config.stepPresentations[stepKey];
    return {
      stepKey,
      label: translate(config, locale, pres.titleKey),
      detail: translate(config, locale, pres.detailKey),
      icon: pres.icon,
      state: milestoneStateFor(order, rank),
    };
  });

  const eta = etaFor(config, order, nowMs);

  let pendingInput: TrackerViewModel["pendingInput"] = null;
  if (order.inputState.pending && order.inputState.inputId && order.inputState.schemaKey) {
    const schema = config.inputSchemas[order.inputState.schemaKey];
    if (schema) {
      pendingInput = {
        inputId: order.inputState.inputId,
        schemaKey: schema.schemaKey,
        prompt: translate(config, locale, schema.promptKey),
        options: schema.options.map((opt) => ({
          value: opt.value,
          label: translate(config, locale, opt.labelKey),
        })),
        freeText: schema.freeText,
      };
    }
  }

  return {
    tenant: {
      displayName: config.branding.displayName,
      primaryColor: config.branding.primaryColor,
      ...(config.branding.logoUrl ? { logoUrl: config.branding.logoUrl } : {}),
      locale,
    },
    order: {
      publicToken: order.publicToken,
      status: order.status,
      placedAt: order.createdAt,
    },
    milestones,
    currentStepKey: order.stepKey,
    maxStepRank: order.maxStepRank,
    recheck: isRecheck(order),
    etaIso: eta.etaIso,
    etaMinutes: eta.etaMinutes,
    pendingInput,
    cancelled:
      order.status === "cancelled"
        ? {
            at: order.cancelledAt ?? order.updatedAt,
            reason: order.cancelReason ?? "",
          }
        : null,
    version: order.version,
  };
}

