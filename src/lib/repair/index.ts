import type { CircuitGraph } from '../circuit/types';
import { solveDC, type DCSolution } from '../circuit/solve';
import { validateGraph } from '../circuit/validate';
import { isResistance, modeledHypotheses, probeStep, type Observation, type Reading } from '../probe';

// Repair Studio: Observe -> Diagnose (probe posterior) -> Propose -> Simulate -> Approve -> Verify.
// Every number is solver-simulated; patches only restore the CONFIRMED design (no rewiring, no new voltage).
// Labels: measured (user), simulated (solver), hypothesized (probe), verified (follow-up measurement).

export type FaultClass = 'open' | 'short' | 'value' | 'source';
export type Verification = { instruction: string; node: string; expectVolts: number; toleranceVolts: number };
export type RepairProposal = {
  id: string;
  hypothesisId: string;
  title: string;
  faultClass: FaultClass;
  target: { componentId: string };
  probability: number;
  patch: { kind: 'restore_design'; componentId: string; faultedValue: number; designValue: number; unit: 'ohm' | 'volt' };
  supportingObservations: { node: string; measured: number; predictedIfFault: number; predictedIfRepaired: number }[];
  before: DCSolution;
  after: DCSolution;
  resolves: boolean;
  uncertainty: string;
  verification: Verification;
  actions: string[];
  status: 'hypothesized';
};
export type RepairResult = {
  proposals: RepairProposal[];
  basis: { topHypothesisId: string; topProbability: number; done: boolean; blocked?: 'poor_fit' };
  safety: string;
};

const FAULT_VALUE: Record<string, (v: number) => number> = {
  open: () => 1e9,
  short: () => 1e-3,
  x10: (v) => v * 10,
  'x0.1': (v) => v / 10,
  dead: () => 0,
};
const CLASS: Record<string, FaultClass> = { open: 'open', short: 'short', x10: 'value', 'x0.1': 'value', dead: 'source' };

const sigma = (v: number) => 0.02 * Math.abs(v) + 0.01; // same meter tolerance as probe
const fmtV = (v: number) => `${+v.toPrecision(3)} V`;
const fmtOhm = (r: number) =>
  r >= 1e6 ? `${+(r / 1e6).toPrecision(3)} MΩ` : r >= 1e3 ? `${+(r / 1e3).toPrecision(3)} kΩ` : `${+r.toPrecision(3)} Ω`;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const POWER_DOWN = 'Power the circuit down and disconnect the supply before touching any part.';

export const withValue = (g: CircuitGraph, id: string, value: number): CircuitGraph => ({
  ...g,
  components: g.components.map((c) => (c.id === id ? { ...c, value } : c)),
});

export type FaultCase = {
  comp: CircuitGraph['components'][number];
  fclass: FaultClass;
  faultedValue: number;
  before: DCSolution;
  vNode: string;
  expectVolts: number;
};

/** Shared by repairStep and verifyHypothesis: patch + verification node/expectation, all server-derived. null = invalid/unsolvable fault id. */
export function faultCase(graph: CircuitGraph, hypothesisId: string, nodes: string[], after = solveDC(graph)): FaultCase | null {
  const [componentId, key] = hypothesisId.split(':');
  const comp = graph.components.find((c) => c.id === componentId);
  if (!comp || !FAULT_VALUE[key]) return null;
  const faultedValue = FAULT_VALUE[key](comp.value);
  // Safety: the patched graph (= confirmed design) must validate; the faulted model must solve.
  if (!validateGraph(withValue(graph, comp.id, comp.value)).ok) return null;
  let before: DCSolution;
  try {
    before = solveDC(withValue(graph, comp.id, faultedValue));
  } catch {
    return null;
  }
  // Most discriminating node after the fix (first node wins ties: deterministic).
  let vNode = nodes[0];
  for (const n of nodes)
    if (Math.abs(after.voltages[n] - before.voltages[n]) > Math.abs(after.voltages[vNode] - before.voltages[vNode]) + 1e-12) vNode = n;
  return { comp, fclass: CLASS[key], faultedValue, before, vNode, expectVolts: after.voltages[vNode] };
}

export class RepairError extends Error {}

export function repairStep(graph: CircuitGraph, readings: Reading[]): RepairResult {
  const step = probeStep(graph, readings); // resistance readings (ohmmeter mode) count as evidence; support is shown for voltages
  const observations = readings.filter((o): o is Observation => !isResistance(o));
  const hyps = modeledHypotheses(step); // repairs are proposed among modeled faults only; step.fitWarning carries the misfit
  // No repair is proposed when no modeled fault explains the readings: a confident-looking fix would be invented.
  if (step.fit === 'poor' || step.hypotheses[0]?.id === 'unmodeled') {
    const lead = step.hypotheses[0];
    return { proposals: [], basis: { topHypothesisId: lead?.id ?? 'unmodeled', topProbability: lead?.probability ?? 0, done: false, blocked: 'poor_fit' }, safety: step.safety };
  }
  const top = hyps[0];
  if (!top) throw new RepairError('Circuit could not be solved.');
  const nodes = Object.keys(top.predicted).filter((n) => n !== graph.groundNode);
  const obs = observations.filter((o) => nodes.includes(o.node));
  const after = solveDC(graph); // simulated: confirmed design. Patch = restore this; never raises a source above design.

  const proposals: RepairProposal[] = [];
  for (const h of hyps) {
    if (h.id === 'nominal' || h.probability < 0.05) continue;
    const fc = faultCase(graph, h.id, nodes, after);
    if (!fc) continue;
    const { comp, fclass, faultedValue, before, vNode, expectVolts } = fc;

    const supporting = obs.map((o) => ({
      node: o.node,
      measured: o.volts,
      predictedIfFault: before.voltages[o.node],
      predictedIfRepaired: after.voltages[o.node],
    }));
    const fits = supporting.every((s) => Math.abs(s.measured - s.predictedIfFault) <= sigma(s.measured));
    const differs = supporting.some((s) => Math.abs(s.predictedIfRepaired - s.predictedIfFault) > sigma(s.predictedIfRepaired));
    const resolves = obs.length > 0 && fits && differs;

    const others = hyps.filter((o) => o.id !== h.id && o.id !== 'nominal' && o.probability >= 0.05);
    const uncertainty = [
      others.length ? `Alternatives: ${others.map((o) => `${o.title} (${pct(o.probability)})`).join('; ')}.` : 'No other hypothesis above 5%.',
      `This is a hypothesis (${pct(h.probability)}), not a confirmed fault.`,
      step.fitWarning ? `Misfit: ${step.fitWarning}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const design = fclass === 'source' ? fmtV(comp.value) : fmtOhm(comp.value);
    const [title, steps] =
      fclass === 'open'
        ? [`Restore ${comp.id} connection`, [`Inspect and reseat ${comp.id} (leads, solder joints, breadboard row); replace it if damaged.`]]
        : fclass === 'short'
          ? [`Remove short across ${comp.id}`, [`Look for a stray wire, solder bridge or misplaced jumper across ${comp.id} and remove it.`]]
          : fclass === 'value'
            ? [`Replace ${comp.id} with ${design}`, [`Check the colour bands on ${comp.id}; replace it with the ${design} design value.`]]
            : [`Restore ${comp.id} supply to ${design}`, [`Check ${comp.id} connections and switch, then set it back to the design ${design}. Never exceed the design voltage.`]];

    proposals.push({
      id: `fix-${h.id}`,
      hypothesisId: h.id,
      title,
      faultClass: fclass,
      target: { componentId: comp.id },
      probability: h.probability,
      patch: { kind: 'restore_design', componentId: comp.id, faultedValue, designValue: comp.value, unit: fclass === 'source' ? 'volt' : 'ohm' },
      supportingObservations: supporting,
      before,
      after,
      resolves,
      uncertainty,
      verification: {
        instruction: `With the circuit powered, black probe on ${graph.groundNode}, red probe on ${vNode}; enter the DC voltage.`,
        node: vNode,
        expectVolts,
        toleranceVolts: sigma(expectVolts),
      },
      actions: [
        POWER_DOWN,
        ...steps,
        `Power up and re-measure ${vNode} (expected ${fmtV(expectVolts)}).`,
        'Never measure resistance while the circuit is energized.',
      ],
      status: 'hypothesized',
    });
    if (proposals.length === 3) break;
  }
  return { proposals, basis: { topHypothesisId: top.id, topProbability: top.probability, done: step.done }, safety: step.safety };
}

export function verifyRepair(
  verification: { node: string; expectVolts: number; toleranceVolts: number },
  measured: { node: string; volts: number },
) {
  if (measured.node !== verification.node)
    return { verified: false, status: 'not_verified' as const, delta: Number.NaN, message: `Wrong node: measure ${verification.node}, not ${measured.node}. Not verified.` };
  const delta = measured.volts - verification.expectVolts;
  const ok = Math.abs(delta) <= verification.toleranceVolts;
  const band = `expected ${fmtV(verification.expectVolts)} ± ${fmtV(verification.toleranceVolts)}`;
  return {
    verified: ok,
    status: ok ? ('verified' as const) : ('not_verified' as const),
    delta,
    message: ok
      ? `Measured ${fmtV(measured.volts)} at ${measured.node}, consistent with the repair (${band}).`
      : `Measured ${fmtV(measured.volts)} at ${measured.node} does not match; re-check the repair (${band}).`,
  };
}

export class VerifyInputError extends Error {
  constructor(public code: 'UNKNOWN_HYPOTHESIS' | 'UNKNOWN_NODE', message: string) {
    super(message);
  }
}

/** Server-authoritative verify: hypothesis, node, expected volts and tolerance all come from the confirmed graph, never the client. */
export function verifyHypothesis(graph: CircuitGraph, hypothesisId: string, measured: { node: string; volts: number }) {
  const step = probeStep(graph, []);
  const top = modeledHypotheses(step)[0]; // 'unmodeled' has no predicted voltages
  const nodes = top ? Object.keys(top.predicted).filter((n) => n !== graph.groundNode) : [];
  const fc = hypothesisId !== 'nominal' && step.hypotheses.some((h) => h.id === hypothesisId) ? faultCase(graph, hypothesisId, nodes) : null;
  if (!fc) throw new VerifyInputError('UNKNOWN_HYPOTHESIS', `Unknown hypothesis "${hypothesisId}" for this circuit.`);
  if (!nodes.includes(measured.node)) throw new VerifyInputError('UNKNOWN_NODE', `Node "${measured.node}" is not a measurable node of this circuit.`);
  const verification = { node: fc.vNode, expectVolts: fc.expectVolts, toleranceVolts: sigma(fc.expectVolts) };
  return { ...verifyRepair(verification, measured), ...verification, hypothesisId, basis: 'server_recomputed' as const };
}
