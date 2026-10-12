import { allowedNumbers, checkGrounding } from '../src/lib/explain';
import { solveDC } from '../src/lib/circuit/solve';
import { DIVIDER_10K_10K } from '../src/lib/circuit/fixtures';

// Labelled grounding corpus. Facts come from the real pipeline on DIVIDER_10K_10K
// (V1 5 V; R1 = R2 = 10 kOhm; VOUT 2.5 V; I = 0.25 mA; 1.25 mW supplied, 0.625 mW per resistor).
// accept = a correct explanation sentence must pass; reject = a hallucinated/mis-typed claim must be flagged.
export type GroundingCase = { text: string; accept: boolean; why?: string };

export const CORPUS: GroundingCase[] = [
  // ---- must accept ----
  { text: 'VOUT is 2.5 V.', accept: true },
  { text: 'The loop current is 0.25 mA.', accept: true },
  { text: 'R1 is 10 kΩ and R2 is 10 kΩ.', accept: true },
  { text: 'Each resistor drops 2.5 V.', accept: true },
  { text: 'Step 1: the source supplies 5 V.', accept: true },
  { text: 'The source sees 20 kΩ in total.', accept: true },
  { text: 'That is 250 µA.', accept: true },
  { text: 'VIN is 5.00 V.', accept: true },
  { text: 'About 2.50 V appears at VOUT.', accept: true },
  { text: 'I = 2.5e-4 A.', accept: true, why: 'scientific notation of a true value' },
  { text: 'R = 10,000 Ω.', accept: true },
  { text: 'R = 10 000 Ω.', accept: true, why: 'space thousands separator' },
  { text: 'R = 10 000 Ω.', accept: true, why: 'narrow no-break space thousands separator' },
  { text: 'The total is 20000 ohms.', accept: true },
  { text: 'Step 2: apply the divider rule.', accept: true },
  { text: 'Step 3: 0.25 mA flows through both resistors.', accept: true },
  { text: 'It is 5V at the supply.', accept: true, why: 'glued unit' },
  { text: 'I = 0.25mA.', accept: true },
  { text: 'The node sits at 2.5 volts.', accept: true },
  { text: 'Resistance is 10 kilohms.', accept: true },
  { text: 'The resistor dissipates 0.625 mW.', accept: true },
  { text: 'The source delivers 1.25 mW.', accept: true },
  { text: 'VOUT = 2.5 V, which is half of the 5 V supply.', accept: true },
  { text: 'KVL: 5 V = 2.5 V + 2.5 V.', accept: true },
  { text: 'Ohm: 5 V / 20 kΩ = 0.25 mA.', accept: true },
  { text: 'Rounded to 3 significant figures, VOUT = 2.50 V.', accept: true },
  { text: 'With R1 and R2 equal, VOUT splits the supply evenly.', accept: true, why: 'component ids are not numbers' },
  { text: 'Step 4: disconnect power before measuring resistance.', accept: true },
  // ---- must reject ----
  { text: 'VOUT is 7 V.', accept: false, why: 'free integer 0..10 allowed as a voltage' },
  { text: 'The supply is 10 V.', accept: false, why: '10 is a resistance (kΩ), not a voltage' },
  { text: 'The loop current is 2.5 A.', accept: false, why: 'unit-blind: 2.5 exists only as volts' },
  { text: 'Current is 5 A.', accept: false, why: 'unit-blind: 5 exists only as volts' },
  { text: 'R2 is 2.5 Ω.', accept: false, why: 'unit-blind: 2.5 V exists' },
  { text: 'It drops 0.25 V.', accept: false, why: '0.25 exists only as mA' },
  { text: 'It reads 99volts.', accept: false, why: 'glued unit word escaped extraction' },
  { text: 'R is 1e5 ohms.', accept: false, why: 'scientific notation escaped' },
  { text: 'The node is at 6.02e23 V.', accept: false },
  { text: 'The current is 2.5e-3 A.', accept: false, why: 'sci-notation wrong value' },
  { text: 'The load is 1 000 000 Ω.', accept: false, why: 'space thousands split into 1 / 000 / 000' },
  { text: 'The load is 1,000,000 Ω.', accept: false },
  { text: 'The load is 10 000 000 Ω.', accept: false, why: 'splits into free integers' },
  { text: 'The current is 2.5 mA.', accept: false, why: 'wrong by 10x' },
  { text: 'R1 is 5 kΩ.', accept: false },
  { text: 'R1 dissipates 3 W.', accept: false },
  { text: 'The resistor burns 2.5 W.', accept: false, why: '2.5 only exists as volts' },
  { text: 'Voltage drops by 50% across R1.', accept: false, why: 'percentages are forbidden claims' },
  { text: 'The ratio is 1:3.', accept: false },
  { text: 'Step 9: the circuit is fine.', accept: false, why: 'step ordinal beyond the 5-step cap' },
  { text: 'VOUT would be 3 V.', accept: false },
  { text: 'It reads 0.5 V at the midpoint.', accept: false },
];

const graph = DIVIDER_10K_10K;
const sol = solveDC(graph);

export function evaluateGrounding(corpus: GroundingCase[]) {
  const allowed = allowedNumbers(graph, sol);
  const rows = corpus.map((c) => {
    const ungrounded = checkGrounding(c.text, allowed);
    return { ...c, ungrounded, accepted: ungrounded.length === 0 };
  });
  const rejects = rows.filter((r) => !r.accept), accepts = rows.filter((r) => r.accept);
  const falseAccepts = rejects.filter((r) => r.accepted), falseRejects = accepts.filter((r) => !r.accepted);
  return {
    summary: {
      cases: rows.length, mustAccept: accepts.length, mustReject: rejects.length,
      falseAccept: falseAccepts.length, falseAcceptRate: +(falseAccepts.length / rejects.length).toFixed(3),
      falseReject: falseRejects.length, falseRejectRate: +(falseRejects.length / accepts.length).toFixed(3),
    },
    falseAccepts: falseAccepts.map((r) => r.text),
    falseRejects: falseRejects.map((r) => r.text),
    rows,
  };
}
