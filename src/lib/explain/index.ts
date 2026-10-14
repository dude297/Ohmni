import { GoogleGenAI } from '@google/genai';
import { fence, FENCE_RULE } from '../ai/fence';
import { z } from 'zod';
import { validateGraph } from '../circuit/validate';
import { solveDC, SolveError } from '../circuit/solve';
import { diagnose } from '../diagnosis';
import type { CircuitGraph, ModelTraceEvent, SolveResponse } from '../circuit/types';

// Owner: Agent T. Solver-grounded tutor: the MNA solver is the only math authority; the LLM only writes prose,
// and every number in that prose is checked against solver/diagnosis output in code.
const TIMEOUT_MS = 15_000;
export const explainModel = () => process.env.EXPLAIN_MODEL || 'gemini-3.5-flash-lite';

export type Explanation = { summary: string; steps: { title: string; text: string }[] };
export type ExplainResult = {
  explanation: Explanation | null;
  grounded: boolean;
  ungroundedNumbers: string[];
  facts: { voltages: Record<string, number>; currents: Record<string, number>; hypotheses?: { title: string }[] };
  trace: ModelTraceEvent[];
};
export type ExplainOutcome =
  | { ok: true; result: ExplainResult }
  | { ok: false; status: 422; code: 'INVALID_GRAPH' | 'UNSOLVABLE'; message: string; details?: string[] };

// ---- grounding checker ----
// Every digit run in the prose is a typed claim {value, dimension}. A claim is grounded only when a fact of the SAME
// dimension matches (honest rounding allowed). Unitless numbers are only allowed as step ordinals ("Step 2").
export type Dim = 'V' | 'A' | 'Ω' | 'W' | 'none' | 'pct' | 'any';
export type Fact = { value: number; dim: Dim }; // dim 'any' = dimension unknown (matches every claim)
const SI: Record<string, number> = { kilo: 1e3, kil: 1e3, k: 1e3, K: 1e3, mega: 1e6, meg: 1e6, M: 1e6, milli: 1e-3, m: 1e-3, micro: 1e-6, u: 1e-6, µ: 1e-6, μ: 1e-6 };
const CORE = '(?:[Vv]olts?|[Aa]mps?|[Aa]mperes?|[Oo]hms?|[Ww]atts?|V|A|Ω|W)';
// mantissa (thousands separated by , / space / thin space), optional exponent, optional unit; lookbehind skips ids like R12 / V1
const NUM_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.])(-?(?:\d{1,3}(?:[,\u00a0\u2009\u202f ]\d{3})+(?!\d)|\d+)(?:\.\d+)?|-?\.\d+)` +
    String.raw`(?:[eE]([+-]?\d+)|\s?[x×]\s?10\^?([+\-−]?\d+))?` +
    String.raw`(\s*(?:kilo|kil|mega|meg|milli|micro|k|K|M|m|u|µ|μ)?${CORE}(?![A-Za-z0-9])|\s*[kKM](?![A-Za-z0-9])|\s*%)?` +
    String.raw`(?![A-Za-z0-9])`,
  'g',
);

function parseUnit(u: string | undefined): { scale: number; dim: Dim } {
  const t = (u ?? '').trim();
  if (!t) return { scale: 1, dim: 'none' };
  if (t === '%') return { scale: 1, dim: 'pct' };
  if (/^[kKM]$/.test(t)) return { scale: SI[t], dim: 'Ω' }; // "10k"
  const m = /^(kilo|kil|mega|meg|milli|micro|k|K|M|m|u|µ|μ)?(.+)$/.exec(t)!;
  const core = m[2].toLowerCase();
  const dim: Dim = core.startsWith('v') ? 'V' : core.startsWith('a') ? 'A' : core.startsWith('w') ? 'W' : 'Ω';
  return { scale: m[1] ? SI[m[1]] : 1, dim };
}

export type FoundNumber = { text: string; value: number; scale: number; halfUlp: number; dim: Dim; ordinal?: number };

export function extractNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  for (const m of text.matchAll(NUM_RE)) {
    const { scale, dim } = parseUnit(m[4]);
    const mant = m[1].replace(/[,\u00a0\u2009\u202f ]/g, '');
    const exp = Number((m[2] ?? m[3] ?? '0').replace('−', '-'));
    const dec = mant.split('.')[1]?.length;
    const mult = scale * 10 ** exp;
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    const after = text[m.index + m[0].length] ?? '';
    const isOrdinal =
      dim === 'none' && /^\d+$/.test(mant) && (/\b[Ss]tep\s*#?\s*$/.test(before) || (/(^|\n)\s*$/.test(before) && /[.)]/.test(after)) ||
        /^\s*(significant|sig\b|decimal|digits?\b|places?\b)/i.test(text.slice(m.index + m[0].length))); // "3 significant figures" is precision, not a claim
    out.push({
      text: m[0].trim(),
      value: Number(mant) * mult,
      scale: mult,
      // Half a unit in the last written decimal place: "0.17 mA" stands for anything that rounds to it.
      halfUlp: dec ? 0.5 * 10 ** -dec * mult : 0,
      dim,
      ...(isOrdinal && { ordinal: Number(mant) }),
    });
  }
  return out;
}

const close = (c: FoundNumber, a: number) =>
  Math.abs(Math.abs(c.value) - Math.abs(a)) <= Math.max(0.01 * Math.abs(a), Math.min(c.halfUlp, 0.05 * Math.abs(a)), 1e-6 * c.scale);

/** Returns the claims in `text` that no fact supports: same dimension, and 1% relative, or honest rounding to the
 * written decimals (capped at 5% relative). Plain numbers in `allowed` are dimension-agnostic (legacy). Unitless
 * claims pass only as step ordinals <= maxSteps. */
export function checkGrounding(text: string, allowed: (number | Fact)[], maxSteps = 5): string[] {
  const facts: Fact[] = allowed.map((a) => (typeof a === 'number' ? { value: a, dim: 'any' as const } : a));
  return extractNumbers(text)
    .filter((c) => {
      if (c.ordinal !== undefined && c.ordinal >= 1 && c.ordinal <= maxSteps) return false;
      return !facts.some((f) => (f.dim === 'any' || f.dim === c.dim) && close(c, f.value));
    })
    .map((n) => n.text);
}

export function allowedNumbers(
  graph: CircuitGraph,
  sol: { voltages: Record<string, number>; currents: Record<string, number> },
  measured?: number,
  hyps?: NonNullable<SolveResponse['hypotheses']>,
): Fact[] {
  const set: Fact[] = [];
  const add = (dim: Dim, ...vs: number[]) => vs.forEach((value) => Number.isFinite(value) && set.push({ value, dim }));
  const V = sol.voltages;
  add('V', ...Object.values(V));
  add('A', ...Object.values(sol.currents));
  for (const c of graph.components) {
    const i = Math.abs(sol.currents[c.id]);
    if (c.kind === 'dc_voltage') {
      add('V', c.value);
      if (i > 0) add('Ω', c.value / i); // total load seen by the source (e.g. 20 kΩ)
      add('W', c.value * i);
    } else {
      const drop = V[c.positiveNode] - V[c.negativeNode];
      add('Ω', c.value);
      add('V', drop);
      add('W', Math.abs(drop) * i);
    }
  }
  if (measured !== undefined) add('V', measured, V[graph.measureNode] - measured);
  for (const h of hyps ?? []) for (const n of extractNumbers(`${h.title} ${h.rationale} ${h.nextMeasurement}`)) add(n.dim, n.value);
  return set;
}

// ---- model call ----
const explanationSchema = z.object({
  summary: z.string().min(1),
  steps: z.array(z.object({ title: z.string(), text: z.string() })).min(1).max(5),
});

const PROMPT = `You are an electrical-engineering tutor. Explain the user's DC circuit to an EE student in plain language.
The FACTS JSON below was computed by a circuit solver; it is the only source of truth.
Rules:
- Use ONLY numbers that appear in FACTS (you may write resistances in kΩ and currents in mA, and round to 3 significant figures). Never compute or invent new numbers, percentages or ratios.
- At most 5 steps. Use KVL, KCL, Ohm's law and voltage-divider reasoning where relevant.
- If a measured voltage and hypotheses are given, explain why the measurement may differ, using the hypotheses only; call them hypotheses, not confirmed faults.
- Safety: always say to disconnect power before measuring resistance. Give no unsafe advice.
- Reply with JSON only: {"summary": string, "steps": [{"title": string, "text": string}]}.
- ${FENCE_RULE}
FACTS:
`;

async function callModel(facts: unknown): Promise<{ explanation: Explanation | null; event: ModelTraceEvent }> {
  const model = explainModel();
  const event: ModelTraceEvent = { step: 'explain', provider: 'google', model, durationMs: 0, status: 'ok' };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { explanation: null, event: { ...event, status: 'skipped', note: 'GEMINI_API_KEY not configured' } };

  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // ponytail: Promise.race because the SDK can hang past abortSignal (same as ai/gemini.ts)
    const hang = new Promise<never>((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('timeout'))));
    const res = await Promise.race([
      hang,
      new GoogleGenAI({ apiKey }).models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: PROMPT + fence(JSON.stringify(facts, (_k, v) => (typeof v === 'number' ? +v.toPrecision(4) : v))) }] }],
        config: { temperature: 0.2, responseMimeType: 'application/json', abortSignal: ctrl.signal },
      }),
    ]);
    const u = res.usageMetadata;
    if (u) event.usage = { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount };
    let raw: unknown;
    try {
      raw = JSON.parse(res.text ?? '');
    } catch {
      raw = null;
    }
    const p = explanationSchema.safeParse(raw);
    if (!p.success) return { explanation: null, event: { ...event, status: 'error', note: 'gemini malformed_output' } };
    return { explanation: p.data, event };
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    // ponytail: SDK error text deliberately not copied into the trace (may echo request details)
    const note = ctrl.signal.aborted
      ? `gemini timeout (request timed out after ${TIMEOUT_MS / 1000}s)`
      : `gemini error${typeof status === 'number' ? ` (${status})` : ''}`;
    return { explanation: null, event: { ...event, status: 'error', note } };
  } finally {
    clearTimeout(timer);
    event.durationMs = Date.now() - started;
  }
}

export async function explain(rawGraph: unknown, measuredVoltage?: number): Promise<ExplainOutcome> {
  const v = validateGraph(rawGraph);
  if (!v.ok) return { ok: false, status: 422, code: 'INVALID_GRAPH', message: 'Circuit graph is invalid', details: v.errors };
  const graph = v.graph;
  const t0 = performance.now();
  let sol;
  try {
    sol = solveDC(graph);
  } catch (e) {
    if (e instanceof SolveError) return { ok: false, status: 422, code: 'UNSOLVABLE', message: e.message };
    throw e;
  }
  const solveEvent: ModelTraceEvent = {
    step: 'solve',
    provider: 'local',
    model: 'mna-dc',
    durationMs: Math.round(performance.now() - t0),
    status: 'ok',
  };
  const hyps = measuredVoltage !== undefined ? diagnose(graph, measuredVoltage) : undefined;
  const facts: ExplainResult['facts'] = { voltages: sol.voltages, currents: sol.currents };
  if (hyps) facts.hypotheses = hyps.map((h) => ({ title: h.title }));

  const promptFacts = {
    components: graph.components.map(({ id, kind, value, positiveNode, negativeNode }) => ({ id, kind, value, positiveNode, negativeNode })),
    groundNode: graph.groundNode,
    measureNode: graph.measureNode,
    nodeVoltagesV: sol.voltages,
    componentCurrentsA: sol.currents,
    ...(measuredVoltage !== undefined && { measuredVoltageV: measuredVoltage, hypotheses: hyps }),
  };
  const { explanation, event } = await callModel(promptFacts);
  const ungroundedNumbers = explanation
    ? checkGrounding(
        [explanation.summary, ...explanation.steps.flatMap((s) => [s.title, s.text])].join('\n'),
        allowedNumbers(graph, sol, measuredVoltage, hyps),
      )
    : [];
  return {
    ok: true,
    result: {
      explanation,
      grounded: explanation !== null && ungroundedNumbers.length === 0,
      ungroundedNumbers,
      facts,
      trace: [solveEvent, event],
    },
  };
}
