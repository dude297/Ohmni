import { validateGraph } from '../circuit/validate';
import { solveDC, SolveError, type DCSolution } from '../circuit/solve';
import type { CircuitGraph } from '../circuit/types';
import { mk, mapValidationErrors, structuralFindings, scopeFinding, type Finding } from './rules';

export type ReviewOptions = { ratings?: Record<string, { powerW?: number }>; intended?: CircuitGraph };
export type ReviewResult = { findings: Finding[]; solution?: DCSolution };

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const ASSUME = ['Components are matched by id (refdes); node names are compared literally.'];
const diff = (sev: Finding['severity'], cat: Finding['category'], comps: string[], nodes: string[], s: string, n: Record<string, number> = {}) =>
  mk(sev, cat, comps, nodes, s, n, 'design_diff', ASSUME);

function diffFindings(g: CircuitGraph, intended: unknown): Finding[] {
  const v = validateGraph(intended);
  if (!v.ok) return [mk('info', 'unsolvable', [], [], `Intended design was invalid, so no design comparison was made: ${v.errors.join('; ')}`, {}, 'design_diff')];
  const want = v.graph;
  let effect: Record<string, number> = {};
  try {
    if (want.measureNode === g.measureNode)
      effect = { measureNodeActualV: solveDC(g).voltages[g.measureNode], measureNodeIntendedV: solveDC(want).voltages[want.measureNode] };
  } catch { /* solver numbers are optional */ }
  const out: Finding[] = [];
  const have = new Map(g.components.map((c) => [c.id, c]));
  for (const w of want.components) {
    const c = have.get(w.id);
    if (!c) { out.push(diff('error', 'connectivity_mismatch', [w.id], [w.positiveNode, w.negativeNode], `${w.id} is in the intended design but missing from the circuit.`)); continue; }
    if (c.kind !== w.kind) { out.push(diff('error', 'connectivity_mismatch', [w.id], [], `${w.id} is a ${c.kind} but the intended design has a ${w.kind}.`)); continue; }
    const same = c.positiveNode === w.positiveNode && c.negativeNode === w.negativeNode;
    const swapped = c.positiveNode === w.negativeNode && c.negativeNode === w.positiveNode;
    if (!same && !(swapped && c.kind === 'resistor'))
      out.push(diff('error', 'connectivity_mismatch', [w.id], [c.positiveNode, c.negativeNode],
        swapped ? `${w.id} polarity is reversed relative to the intended design.`
          : `${w.id} connects ${c.positiveNode}-${c.negativeNode} but the intended design connects ${w.positiveNode}-${w.negativeNode}.`));
    if (!near(c.value, w.value))
      out.push(diff('error', 'value_mismatch', [w.id], [], `${w.id} is ${c.value} ${c.kind === 'resistor' ? 'ohm' : 'V'} but the intended design has ${w.value}.`,
        { actualValue: c.value, intendedValue: w.value, ...effect }));
  }
  for (const c of g.components)
    if (!want.components.some((w) => w.id === c.id))
      out.push(diff('warning', 'connectivity_mismatch', [c.id], [c.positiveNode, c.negativeNode], `${c.id} is in the circuit but not in the intended design.`));
  return out;
}

export function reviewCircuit(raw: unknown, opts: ReviewOptions = {}): ReviewResult {
  const v = validateGraph(raw);
  if (!v.ok) return { findings: [...mapValidationErrors(v.errors, raw), scopeFinding()] };
  const g = v.graph;
  const findings = structuralFindings(g);
  let solution: DCSolution | undefined;
  try {
    solution = solveDC(g);
  } catch (e) {
    if (!(e instanceof SolveError)) throw e;
    if (!findings.some((f) => f.severity === 'error'))
      findings.push(mk('error', 'unsolvable', [], [], `The DC solver could not solve this circuit: ${e.message}`, {}, 'simulation'));
  }
  if (solution) {
    const unrated: string[] = [];
    for (const c of g.components.filter((c) => c.kind === 'resistor')) {
      const rating = opts.ratings?.[c.id]?.powerW;
      if (rating === undefined) { unrated.push(c.id); continue; }
      const i = solution.currents[c.id];
      const p = i * i * c.value;
      if (p > rating)
        findings.push(mk('error', 'power_dissipation', [c.id], [c.positiveNode, c.negativeNode],
          `${c.id} dissipates P = I^2 R = ${p} W, above its ${rating} W rating.`,
          { powerW: p, ratingW: rating, currentA: Math.abs(i), resistanceOhm: c.value }, 'simulation',
          ['Steady-state DC; rating compared directly with no derating.']));
    }
    if (unrated.length)
      findings.push(mk('info', 'power_dissipation', unrated, [], `No rating given for ${unrated.join(', ')}; power dissipation was not checked.`));
    for (const s of g.components.filter((c) => c.kind === 'dc_voltage'))
      if (Math.abs(solution.currents[s.id]) < 1e-12)
        findings.push(mk('info', 'open_or_unconnected', [s.id], [s.positiveNode, s.negativeNode], `${s.id} delivers no current: the circuit it drives is open.`, { sourceCurrentA: solution.currents[s.id] }, 'simulation'));
  }
  if (opts.intended) findings.push(...diffFindings(g, opts.intended));
  findings.push(scopeFinding());
  return { findings, ...(solution && { solution }) };
}
