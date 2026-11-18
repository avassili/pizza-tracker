/**
 * The five canonical steps of the pizza tracker.
 * See docs/TACTICAL-DESIGN.md §1. The list is ordered by rank, so
 * STEP_BY_RANK is simply STEP_KEYS.
 */

export const STEP_KEYS = [
  "orderPlaced",
  "orderInProgress_Stage1",
  "orderInProgress_Stage2",
  "orderInProgress_Stage3",
  "orderComplete",
] as const;

export type StepKey = (typeof STEP_KEYS)[number];

export const STEP_RANK: Record<StepKey, number> = {
  orderPlaced: 0,
  orderInProgress_Stage1: 1,
  orderInProgress_Stage2: 2,
  orderInProgress_Stage3: 3,
  orderComplete: 4,
};

/** Index == rank. */
export const STEP_BY_RANK: readonly StepKey[] = STEP_KEYS;

/** Highest rank in the flow (4). */
export const LAST_RANK = STEP_KEYS.length - 1;

/** Stages 1-3 are the only steps that support restart / loopback. */
export const FIRST_IN_PROGRESS_RANK = 1;

export function isStepKey(value: unknown): value is StepKey {
  return typeof value === "string" && (STEP_KEYS as readonly string[]).includes(value);
}

export function rankOf(step: StepKey): number {
  return STEP_RANK[step];
}

/** Next step, or null when already at orderComplete. */
export function nextStep(step: StepKey): StepKey | null {
  const rank = STEP_RANK[step];
  return rank >= LAST_RANK ? null : STEP_BY_RANK[rank + 1];
}

/** Previous step, or null when already at orderPlaced. */
export function prevStep(step: StepKey): StepKey | null {
  const rank = STEP_RANK[step];
  return rank <= 0 ? null : STEP_BY_RANK[rank - 1];
}

export function isTerminalStep(step: StepKey): boolean {
  return step === "orderComplete";
}
