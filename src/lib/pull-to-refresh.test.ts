import { describe, expect, it } from "vitest";
import {
  PULL_DEAD_ZONE,
  PULL_MAX_DISTANCE,
  PULL_THRESHOLD,
  calculatePullDistance,
  getPullPhase,
  getPullProgress,
} from "./pull-to-refresh";

describe("pull-to-refresh helpers", () => {
  it("ignora deslocamentos negativos, zero ou dentro da dead-zone", () => {
    expect(calculatePullDistance(-40)).toBe(0);
    expect(calculatePullDistance(0)).toBe(0);
    expect(calculatePullDistance(PULL_DEAD_ZONE)).toBe(0);
    expect(calculatePullDistance(Number.NaN)).toBe(0);
  });

  it("aplica curva de resistência crescente e respeita o limite máximo", () => {
    const small = calculatePullDistance(40);
    const medium = calculatePullDistance(140);
    const huge = calculatePullDistance(2000);

    expect(small).toBeGreaterThan(0);
    expect(medium).toBeGreaterThan(small);
    expect(medium).toBeLessThan(140);
    expect(huge).toBeLessThanOrEqual(PULL_MAX_DISTANCE);
    expect(huge).toBeGreaterThan(PULL_THRESHOLD);
  });

  it("determina corretamente as fases do gesto", () => {
    expect(getPullPhase(0, false)).toBe("idle");
    expect(getPullPhase(20, false)).toBe("pulling");
    expect(getPullPhase(PULL_THRESHOLD - 0.1, false)).toBe("pulling");
    expect(getPullPhase(PULL_THRESHOLD, false)).toBe("ready");
    expect(getPullPhase(PULL_MAX_DISTANCE, false)).toBe("ready");
    expect(getPullPhase(0, true)).toBe("refreshing");
    expect(getPullPhase(PULL_THRESHOLD, true)).toBe("refreshing");
  });

  it("calcula o progresso normalizado entre 0 e 1", () => {
    expect(getPullProgress(-10)).toBe(0);
    expect(getPullProgress(0)).toBe(0);
    expect(getPullProgress(PULL_THRESHOLD / 2)).toBeCloseTo(0.5, 5);
    expect(getPullProgress(PULL_THRESHOLD)).toBe(1);
    expect(getPullProgress(PULL_MAX_DISTANCE)).toBe(1);
  });
});
