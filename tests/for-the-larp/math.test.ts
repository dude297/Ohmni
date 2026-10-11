import { describe, expect, it } from "vitest";
import { buildMNA, expectedBits } from "../../src/app/for-the-larp/math";
import { FIXTURES, LADDER_5V } from "../../src/app/for-the-larp/data";
import { solveDC } from "../../src/lib/circuit/solve";
import { probeStep } from "../../src/lib/probe";

describe("for-the-larp MNA display helper", () => {
  for (const f of FIXTURES) {
    it(`reproduces solveDC exactly for ${f.key}`, () => {
      const m = buildMNA(f.graph);
      const s = solveDC(f.graph);
      m.nodes.forEach((n, i) => expect(m.x[i]).toBe(s.voltages[n]));
      m.sources.forEach((id, k) => expect(m.x[m.nodes.length + k]).toBe(s.currents[id]));
      // A x = b
      m.A.forEach((row, i) => expect(row.reduce((acc, a, j) => acc + a * m.x[j], 0)).toBeCloseTo(m.b[i], 12));
    });
  }
  it("divider has the textbook 2x2 G block and VOUT = 2.5 V", () => {
    const m = buildMNA(FIXTURES[0].graph);
    expect(m.nodes).toEqual(["VIN", "VOUT"]);
    expect(m.A[0][0]).toBeCloseTo(1e-4);
    expect(m.A[1][1]).toBeCloseTo(2e-4);
    expect(m.x[1]).toBeCloseTo(2.5, 12);
  });
});

describe("for-the-larp per-node information gain", () => {
  it("matches probeStep's chosen node after ladder B = 0", () => {
    const step = probeStep(LADDER_5V, [{ node: "B", volts: 0 }]);
    expect(step.next?.node).toBe("A");
    expect(expectedBits(step.hypotheses, "A")).toBeCloseTo(step.next!.expectedBits, 12);
    expect(expectedBits(step.hypotheses, "VIN")).toBeLessThan(step.next!.expectedBits);
  });
});
