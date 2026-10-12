import { describe, expect, it } from "vitest";
import { solveDC } from "../../src/lib/circuit/solve";
import { canShowHint, dividerGraph, errorPct, formulaVout, hintText, isCorrect, TOL_PCT } from "../../src/app/learn/lesson";

describe("learn lesson", () => {
  it("formula equals solveDC within 1e-9", () => {
    for (const r2 of [100, 1000, 4700, 10000, 68000, 100000])
      expect(Math.abs(formulaVout(r2) - solveDC(dividerGraph(r2)).voltages.VOUT)).toBeLessThan(1e-9);
  });
  it("error pct", () => expect(errorPct(2.75, 2.5)).toBeCloseTo(10));
  it("hints gate sequentially and lock after reveal", () => {
    expect(canShowHint(2, 0, false)).toBe(false);
    expect(canShowHint(1, 0, false)).toBe(true);
    expect(canShowHint(2, 1, false)).toBe(true);
    expect(canShowHint(3, 2, true)).toBe(false);
  });
  it("hint 1 has no answer", () => expect(hintText(1, 10000)).not.toMatch(/\d\.\d/));
  it("verdict uses stated tolerance", () => {
    expect(TOL_PCT).toBe(5);
    expect(isCorrect(2.55, 2.5)).toBe(true);
    expect(isCorrect(2.75, 2.5)).toBe(false);
  });
});
