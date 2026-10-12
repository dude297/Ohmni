import { describe, expect, it } from "vitest";
import { advancedGraph, isAdvancedGraph } from "../src/components/ohmni/advanced-sample";
import { solveDC } from "../src/lib/circuit/solve";
import { probeStep } from "../src/lib/probe";
import { solveSample } from "../src/components/ohmni/api";

describe("prepared seven-resistor bridge", () => {
  it("refuses the divider-only local fallback", () => {
    expect(() => solveSample(advancedGraph())).toThrow();
  });
  it("matches independent nodal targets and KCL on all coupled nodes", () => {
    const graph = advancedGraph(); const r = solveDC(graph);
    expect(r.voltages.A).toBeCloseTo(7.342, 2);
    expect(r.voltages.B).toBeCloseTo(4.087, 2);
    expect(r.voltages.C).toBeCloseTo(2.609, 2);
    for (const node of ["A", "B", "C"]) {
      const residual = graph.components.filter(c => c.kind === "resistor").reduce((sum,c) => sum + (c.positiveNode===node ? (r.voltages[node]-r.voltages[c.negativeNode])/c.value : c.negativeNode===node ? (r.voltages[node]-r.voltages[c.positiveNode])/c.value : 0),0);
      expect(Math.abs(residual)).toBeLessThan(1e-12);
    }
  });
  it("checks R6 open by removing its branch, not inventing output voltages", () => {
    const graph = advancedGraph(); graph.components = graph.components.filter(c=>c.id!=="R6");
    const r = solveDC(graph);
    expect(r.voltages.A).toBeCloseTo(7.533,2); expect(r.voltages.B).toBeCloseTo(5.220,2); expect(r.voltages.C).toBe(0);
  });
  it("lets the actual fault model select the next node and narrow an R6-open case", () => {
    const graph=advancedGraph();const fault=advancedGraph();fault.components=fault.components.filter(c=>c.id!=="R6");
    const voltages=solveDC(fault).voltages;const obs=[{node:"C",volts:voltages.C}];
    let step=probeStep(graph,obs);
    for(let i=0;i<4 && step.next;i++){obs.push({node:step.next.node,volts:voltages[step.next.node]});step=probeStep(graph,obs);}
    expect(step.hypotheses[0].id).toBe("R6:open");expect(step.hypotheses[0].probability).toBeGreaterThan(.9);
  });
  it("never reuses the orthogonal drawing after electrical topology changes", () => {
    const graph=advancedGraph();expect(isAdvancedGraph(graph)).toBe(true);
    graph.components[1].negativeNode="B";expect(isAdvancedGraph(graph)).toBe(false);
  });
});
