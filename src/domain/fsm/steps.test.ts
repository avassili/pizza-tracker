import { describe, expect, it } from "vitest";
import {
  FIRST_IN_PROGRESS_RANK,
  LAST_RANK,
  STEP_BY_RANK,
  STEP_KEYS,
  STEP_RANK,
  isStepKey,
  isTerminalStep,
  nextStep,
  prevStep,
  rankOf,
} from "./steps";

describe("step registry", () => {
  it("declares exactly five steps", () => {
    expect(STEP_KEYS).toHaveLength(5);
  });

  it("assigns contiguous ranks 0..4 in declaration order", () => {
    expect(STEP_KEYS.map((step) => STEP_RANK[step])).toEqual([0, 1, 2, 3, 4]);
    expect(LAST_RANK).toBe(4);
  });

  it("maps rank back to the same step", () => {
    for (const step of STEP_KEYS) {
      expect(STEP_BY_RANK[rankOf(step)]).toBe(step);
    }
  });

  it("rejects unknown step keys", () => {
    expect(isStepKey("ordered")).toBe(false);
    expect(isStepKey("orderInProgress_Stage1")).toBe(true);
    expect(isStepKey(undefined)).toBe(false);
    expect(isStepKey(1)).toBe(false);
  });

  it("walks forward and stops at orderComplete", () => {
    expect(nextStep("orderPlaced")).toBe("orderInProgress_Stage1");
    expect(nextStep("orderInProgress_Stage3")).toBe("orderComplete");
    expect(nextStep("orderComplete")).toBeNull();
  });

  it("walks backward and stops at orderPlaced", () => {
    expect(prevStep("orderInProgress_Stage1")).toBe("orderPlaced");
    expect(prevStep("orderPlaced")).toBeNull();
  });

  it("knows which steps support restart", () => {
    const restartable = STEP_KEYS.filter((step) => {
      const rank = STEP_RANK[step];
      return rank >= FIRST_IN_PROGRESS_RANK && rank <= LAST_RANK - 1;
    });
    expect(restartable).toEqual([
      "orderInProgress_Stage1",
      "orderInProgress_Stage2",
      "orderInProgress_Stage3",
    ]);
  });

  it("treats only orderComplete as a terminal step", () => {
    expect(STEP_KEYS.filter(isTerminalStep)).toEqual(["orderComplete"]);
  });
});
