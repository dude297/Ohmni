import { describe, expect, it } from "vitest";
import { bitsPhrase, LADDER_5V, outcomePhrase, schematicLayout } from "../../src/app/probe/helpers";

describe("probe overlay helpers", () => {
  it("phrases outcomes", () => {
    expect(outcomePhrase(0, ["V1 dead", "R1 open"], 0.5)).toBe("≈ 0 V → V1 dead or R1 open (50%)");
    expect(outcomePhrase(2.5, ["a", "b", "c", "d"], 0.004)).toBe("≈ 2.5 V → a or b or c +1 more (<1%)");
  });
  it("phrases bits", () => {
    expect(bitsPhrase(1)).toContain("half");
    expect(bitsPhrase(0.5)).toContain("splits");
    expect(bitsPhrase(0.1)).toContain("narrows");
  });
  it("lays out the real graph node names, ground last", () => {
    const l = schematicLayout(LADDER_5V);
    expect(l.nodes.map((n) => n.name)).toEqual(["VIN", "A", "B", "GND"]);
    expect(l.parts).toHaveLength(4);
    expect(l.parts.find((p) => p.id === "R2")!.a.name).toBe("A");
    expect(l.height).toBeGreaterThan(l.nodes[3].y);
  });
});
