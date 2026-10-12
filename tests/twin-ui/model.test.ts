import { describe, expect, it } from "vitest";
import {
  applyScenario, bridgeSlots, diffModel, evidenceBadge, formatValue, graphFromRows, importDesign, intendedBadge,
  junctions, observedBadge, railTaps, parseEvidenceCsv, parseValue, reroutePath, rowsFromGraph, slotOf, valueBadge, verifyBadge,
} from "../../src/app/twin/model";
import { api } from "../../src/app/twin/api";
import { BRIDGE_NETLIST } from "../../src/app/twin/fixture";

const design = importDesign(BRIDGE_NETLIST, "VOUT").graph!;

describe("netlist + values", () => {
  it("imports the bridge fixture with the API's node names", () => {
    expect(design.components).toHaveLength(8);
    expect(design.measureNode).toBe("VOUT");
    const r6 = design.components.find((c) => c.id === "R6")!;
    expect(r6).toMatchObject({ kind: "resistor", value: 680, positiveNode: "B", negativeNode: "VOUT" });
    expect(design.components.find((c) => c.id === "R1")!.negativeNode).toBe("N1");
    expect(design.components.find((c) => c.id === "V1")).toMatchObject({ kind: "dc_voltage", value: 12, positiveNode: "VIN", negativeNode: "GND" });
  });
  it("derives layout slots from topology, not names", () => {
    const s = bridgeSlots(design)!;
    expect(s).toEqual({ VIN: "VIN", A: "N1", B: "B", C: "VOUT", GND: "GND" });
    expect(slotOf(s, "VOUT")).toBe("C");
    expect(bridgeSlots({ ...design, components: design.components.slice(1) })).toBeNull();
  });
  it("rejects bad input", () => {
    expect(importDesign("hello").error).toBeTruthy();
    expect(importDesign("x".repeat(70_000)).error).toMatch(/64 KB/);
  });
  it("parses and formats values", () => {
    expect(parseValue("4k7")).toBeCloseTo(4700);
    expect(parseValue("6.8k")).toBe(6800);
    expect(parseValue("680 Ω")).toBe(680);
    expect(parseValue("abc")).toBeNull();
    expect(formatValue(680)).toBe("680 Ω");
    expect(formatValue(6800)).toBe("6.8 kΩ");
    expect(formatValue(12, "dc_voltage")).toBe("12 V");
  });
});

describe("observed table + scenarios", () => {
  const rows = rowsFromGraph(design);
  it("round-trips unchanged rows", () => {
    expect(graphFromRows(rows, "C").graph!.components).toEqual(design.components);
  });
  it("value scenario edits only R6 value", () => {
    const g = graphFromRows(applyScenario(rows, "value"), "C").graph!;
    expect(g.components.find((c) => c.id === "R6")!.value).toBe(6800);
    expect(g.components.find((c) => c.id === "R7")!.value).toBe(1200);
  });
  it("wiring scenario moves R6 negative to GND", () => {
    expect(graphFromRows(applyScenario(rows, "wiring"), "C").graph!.components.find((c) => c.id === "R6")!.negativeNode).toBe("GND");
    expect(applyScenario(rows, null)).toEqual(rows);
  });
  it("flags invalid values", () => {
    expect(graphFromRows([{ ...rows[1], value: "zz" }], "C").error).toMatch(/R1/);
  });
});

describe("layout", () => {
  it("draws junction dots only where 3+ terminals meet (A and B, not C)", () => {
    const pts = junctions(design).map((p) => p.join(","));
    expect(pts).toContain("150,170");
    expect(pts).toContain("300,170");
    expect(pts).not.toContain("420,170");
  });
  it("re-routes R6 negative to the GND rail", () => {
    expect(reroutePath("R6", "negative", "GND")).toBe("M420 170 H456 V300");
    expect(reroutePath("ZZ", "negative", "GND")).toBeNull();
  });
});

describe("rail taps", () => {
  it("dots only at T taps, extended by a re-route lead", () => {
    const [vin, gnd] = railTaps(design);
    expect(vin.dots).toEqual([150]);
    expect(gnd.dots).toEqual([150, 300]);
    const g2 = railTaps(design, [[456, 300]])[1];
    expect(g2.dots).toEqual([150, 300, 420]);
    expect(g2.x2).toBe(456);
  });
});

describe("diff model", () => {
  it("renders value and connection diffs", () => {
    const m = diffModel({
      identical: false,
      componentDiffs: [{ componentId: "R6", kind: "value", intended: { kind: "resistor", value: 680 }, observed: { kind: "resistor", value: 6800 }, ratio: 10 }],
      connectionDiffs: [{ componentId: "R6", terminal: "negative", intendedNode: "C", observedNode: "GND" }],
    });
    expect(m.valueTints.R6).toBe("680 Ω → 6.8 kΩ");
    expect(m.reroutes[0].label).toBe("R6− : C → GND");
    expect(diffModel(null)).toEqual({ valueTints: {}, reroutes: [], structural: [] });
  });
});

describe("csv evidence", () => {
  it("parses a synthetic file into observations", () => {
    const r = parseEvidenceCsv("# SYNTHETIC example\nnode,value,unit\nC,0.5,V\nB,7500,mV\n");
    expect(r.errors).toEqual([]);
    expect(r.observations).toEqual([{ node: "C", volts: 0.5 }, { node: "B", volts: 7.5 }]);
  });
  it("refuses unlabeled files and bad rows", () => {
    expect(parseEvidenceCsv("node,value,unit\nC,1,V").errors[0]).toMatch(/SYNTHETIC/);
    expect(parseEvidenceCsv("# synthetic\nnode,value,unit\nC,x,V").errors[0]).toMatch(/Row 1/);
    expect(parseEvidenceCsv("# synthetic\nnode,value,unit\nC,1,A").observations).toEqual([]);
  });
});

describe("api helper", () => {
  it("maps 404 to unavailable and 422 to a message", async () => {
    const orig = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
      expect(await api("/api/twin", {})).toMatchObject({ ok: false, unavailable: true });
      globalThis.fetch = (async () => Response.json({ error: { message: "bad", details: ["unknown node \"Z\""] } }, { status: 422 })) as typeof fetch;
      const r = await api("/api/twin", {});
      expect(r).toMatchObject({ ok: false });
      expect(!r.ok && r.error).toContain("unknown node");
      globalThis.fetch = (async () => Response.json({ result: { a: 1 } })) as typeof fetch;
      expect(await api("/x", {})).toEqual({ ok: true, data: { a: 1 } });
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("badges", () => {
  it("labels provenance honestly", () => {
    expect(intendedBadge("kicad_netlist")).toBe("INTENDED (source: KiCad netlist)");
    expect(intendedBadge("kicad")).toBe("INTENDED (source: KiCad netlist)");
    expect(observedBadge("human_review")).toBe("OBSERVED (human-reviewed)");
  });
  it("MEASURED only for supplied nodes, never 'live'", () => {
    expect(valueBadge("C", { C: "typed" })).toBe("MEASURED");
    expect(valueBadge("C", { C: "file" })).toBe("FILE EVIDENCE");
    expect(valueBadge("A", { C: "typed" })).toBe("SIMULATED");
    expect(evidenceBadge("file")).not.toMatch(/live/i);
  });
  it("VERIFIED only when verified and status agree", () => {
    expect(verifyBadge({ verified: true, status: "verified" })).toBe("VERIFIED");
    expect(verifyBadge({ verified: true, status: "not_verified" })).toBe("NOT VERIFIED");
    expect(verifyBadge({ verified: false, status: "not_verified" })).toBe("NOT VERIFIED");
    expect(verifyBadge(null)).toBeNull();
  });
});
