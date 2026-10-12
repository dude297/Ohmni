import { describe, expect, it } from "vitest";
import { buildPacket, fmtOhms, logRows } from "../../src/app/build/evidence";
import { LOADED_BRIDGE_12V } from "../../src/lib/circuit/fixtures";

describe("evidence log", () => {
  it("residual = measured - predicted nominal", () => {
    const rows = logRows(
      [{ node: "C", volts: 0, at: "t" }, { node: "A", volts: 7.533, at: "t" }, { node: "Z", volts: 1, at: "t" }],
      { C: 2.6, A: 4 },
    );
    expect(rows[0].residual).toBeCloseTo(-2.6);
    expect(rows[1].residual).toBeCloseTo(3.533);
    expect(rows[2].residual).toBeNaN();
  });
  it("packet has contract fields", () => {
    const p = buildPacket({
      circuit: { name: "n", graph: LOADED_BRIDGE_12V, provenance: "fixture" },
      predictions: { voltages: {}, currents: {} },
      observations: [],
      hypotheses: [{ id: "h", title: "t", probability: 0.9 }],
      safety: "s",
    });
    expect(p.schema).toBe("ohmni.evidence.v1");
    expect(p.source).toBe("build");
    expect(p.assumptions.length).toBeGreaterThan(0);
    expect(Date.parse(p.createdAt)).not.toBeNaN();
  });
});

describe("fmtOhms", () => {
  it("renders faults and engineering notation", () => {
    expect([1e9, 1e8, 1e-3, 0, 680, 1500, 4.7e6].map(fmtOhms)).toEqual(["open", "open", "short", "short", "680 Ω", "1.5 kΩ", "4.7 MΩ"]);
  });
});
