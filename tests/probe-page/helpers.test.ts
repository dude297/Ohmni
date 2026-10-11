import { describe, expect, it } from "vitest";
import { addObservation, apiErrorMessage, fmtPct, LADDER_5V, parseVolts } from "../../src/app/probe/helpers";
import { validateGraph } from "../../src/lib/circuit/validate";
import { probeStep } from "../../src/lib/probe";

describe("probe page helpers", () => {
  it("parses volts", () => {
    expect(parseVolts(" 2.5 V")).toBe(2.5);
    expect(parseVolts("")).toBeNull();
    expect(parseVolts("abc")).toBeNull();
    expect(parseVolts("0")).toBe(0);
  });
  it("replaces reading for same node", () => {
    expect(addObservation([{ node: "B", volts: 1 }], { node: "B", volts: 2 })).toEqual([{ node: "B", volts: 2 }]);
  });
  it("formats errors", () => {
    expect(apiErrorMessage(429, { error: { code: "RATE_LIMITED", message: "x" } }, "12")).toContain("12 seconds");
    expect(apiErrorMessage(422, { error: { message: "bad", details: ["a"] } })).toBe("bad: a");
    expect(apiErrorMessage(500, null)).toContain("500");
    expect(fmtPct(0.001)).toBe("<1%");
  });
  it("ladder demo script: B=0 -> probe A -> A=5 -> R2 open", () => {
    expect(validateGraph(LADDER_5V).ok).toBe(true);
    const s1 = probeStep(LADDER_5V, [{ node: "B", volts: 0 }]);
    expect(s1.done).toBe(false);
    expect(s1.next?.node).toBe("A");
    const s2 = probeStep(LADDER_5V, [{ node: "B", volts: 0 }, { node: "A", volts: 5 }]);
    expect(s2.done).toBe(true);
    expect(s2.hypotheses[0].id).toBe("R2:open");
  });
});
