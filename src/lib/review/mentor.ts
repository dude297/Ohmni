import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { validateGraph } from '../circuit/validate';
import { solveDC, SolveError, type DCSolution } from '../circuit/solve';
import { allowedNumbers, checkGrounding, explainModel, extractNumbers } from '../explain';
import type { ModelTraceEvent } from '../circuit/types';
import type { Finding } from './rules';

// Grounded mentor: the model only explains ONE deterministic finding; it can never add findings.
const TIMEOUT_MS = 15_000;
export type Level = 'beginner' | 'intermediate' | 'advanced';
export type MentorInput = { graph: unknown; finding: Finding; level: Level; mode: 'explain' | 'hint'; hintIndex?: number };
export type MentorResult = {
  text: string;
  steps?: { title: string; text: string }[];
  grounded: boolean;
  ungroundedNumbers: string[];
  trace: ModelTraceEvent[];
};

const LEVEL: Record<Level, string> = {
  beginner: 'Plain language, no jargon, one short analogy allowed; name Ohm\'s law or the relevant principle simply.',
  intermediate: 'Assume basic circuit theory; name the principle (Ohm\'s law, KCL, KVL, divider, power) and show the relation.',
  advanced: 'Be concise and rigorous; you may write node equations (e.g. KCL at a node) using symbols and FACT numbers only.',
};
const RULES = `Rules:
- FACTS JSON is the only source of truth. Use ONLY numbers present in FACTS (kΩ / mA forms and rounding to 3 significant figures are ok). Never compute, estimate or invent new numbers, percentages or ratios.
- You explain exactly ONE finding. Never report additional problems, faults or findings.
- Do not claim LED or semiconductor behaviour; only resistors and DC sources are modelled.
- Give no unsafe advice; say to disconnect power before changing wiring.
`;
const explainPrompt = (level: Level) => `You are an electronics mentor reviewing a student's DC circuit. ${LEVEL[level]}
${RULES}Answer: (1) what is wrong, (2) why it matters, (3) which principle applies, (4) what evidence in FACTS shows it, (5) what to check next, (6) what would change if fixed.
Reply with JSON only: {"text": string (short overview), "steps": [{"title": string, "text": string}] (3 to 5 steps)}.
FACTS:
`;
const hintPrompt = (level: Level, i: number) => `You are an electronics mentor giving ONE progressive hint (hint ${i + 1} of 3) about a problem in a student's DC circuit. ${LEVEL[level]}
${RULES}- Do NOT reveal the answer, the fix, or any numeric value. ${['Hint 1: only name the area/principle to think about, as a question.', 'Hint 2: point at which components or nodes to look at and what quantity to compare, without saying the result.', 'Hint 3: describe the exact check the student should do by hand, still without stating the result or the fix.'][i]}
Reply with JSON only: {"text": string} of at most 3 sentences.
FACTS:
`;

const explainSchema = z.object({
  text: z.string().min(1),
  steps: z.array(z.object({ title: z.string(), text: z.string() })).max(6).optional(),
});

const HINTS: Record<string, string[]> = {
  value_mismatch: ['Compare the value you built with the value in your design. Which quantity depends on it?', 'Look at the component named in the finding and the node voltage it controls.', 'Recompute that node voltage by hand with the design value, then with yours, and compare.'],
  connectivity_mismatch: ['Does every part sit between the same two nodes as in your design?', 'Trace the wires of the component named in the finding, terminal by terminal.', 'List the two nodes it should connect in the design and the two it actually connects.'],
  power_dissipation: ['What does the power in a resistor depend on?', 'Look at the resistor in the finding: which voltage is across it and which current flows?', 'Compute P = V x I (or I squared times R) by hand and compare it with the rating you gave.'],
  supply_short: ['What is the resistance between the two terminals of the source?', 'Follow the path from the source + terminal back to its - terminal; list every part on it.', 'Add up the resistance along that path and ask how much current a source would push through it.'],
  supply_conflict: ['What does KVL say about two sources across the same two nodes?', 'Find the two sources that share both nodes.', 'Write down the voltage each source forces between those nodes and compare them.'],
  ground_reference: ['What is the 0 V reference in this circuit?', 'Check how the node named in the finding is labelled.', 'Make sure exactly one node is called GND and everything else is measured from it.'],
  floating_node: ['Does current have a complete loop to flow around?', 'Look at the node in the finding: how many parts touch it?', 'A node with one connection carries no current; decide what it should connect to.'],
};
const hintFallback = (f: Finding, i: number) => (HINTS[f.category] ?? ['Re-read the finding category and think about which law applies.', 'Look at the components it names.', 'Check them against your design by hand.'])[Math.min(Math.max(i, 0), 2)];

async function callModel(
  prompt: string,
  facts: unknown,
): Promise<{ raw: unknown; event: ModelTraceEvent }> {
  const model = explainModel();
  const event: ModelTraceEvent = { step: 'mentor', provider: 'google', model, durationMs: 0, status: 'ok' };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { raw: null, event: { ...event, status: 'skipped', note: 'GEMINI_API_KEY not configured' } };
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const hang = new Promise<never>((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('timeout'))));
    const res = await Promise.race([
      hang,
      new GoogleGenAI({ apiKey }).models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt + JSON.stringify(facts, (_k, v) => (typeof v === 'number' ? +v.toPrecision(4) : v)) }] }],
        config: { temperature: 0.2, responseMimeType: 'application/json', abortSignal: ctrl.signal },
      }),
    ]);
    const u = res.usageMetadata;
    if (u) event.usage = { inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount };
    try {
      return { raw: JSON.parse(res.text ?? ''), event };
    } catch {
      return { raw: null, event: { ...event, status: 'error', note: 'gemini malformed_output' } };
    }
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    const note = ctrl.signal.aborted ? `gemini timeout (${TIMEOUT_MS / 1000}s)` : `gemini error${typeof status === 'number' ? ` (${status})` : ''}`;
    return { raw: null, event: { ...event, status: 'error', note } };
  } finally {
    clearTimeout(timer);
    event.durationMs = Date.now() - started;
  }
}

export async function mentorExplain(input: MentorInput): Promise<MentorResult> {
  const { finding, level, mode } = input;
  const hintIndex = Math.min(Math.max(Math.trunc(input.hintIndex ?? 0), 0), 2);
  const v = validateGraph(input.graph);
  let sol: DCSolution | undefined;
  if (v.ok) {
    try {
      sol = solveDC(v.graph);
    } catch (e) {
      if (!(e instanceof SolveError)) throw e;
    }
  }
  const deterministic = (event: ModelTraceEvent): MentorResult => ({
    text: mode === 'hint'
      ? `Mentor unavailable — deterministic summary: hint ${hintIndex + 1}: ${hintFallback(finding, hintIndex)}`
      : `Mentor unavailable — deterministic summary: ${finding.evidence.statement}`,
    grounded: true,
    ungroundedNumbers: [],
    trace: [event],
  });

  // hints see no numbers at all, so they cannot leak the answer
  const facts = mode === 'hint'
    ? { category: finding.category, components: finding.components, nodes: finding.nodes }
    : {
        finding: { category: finding.category, severity: finding.severity, basis: finding.basis, components: finding.components, nodes: finding.nodes, statement: finding.evidence.statement, numbers: finding.evidence.numbers, assumptions: finding.assumptions },
        ...(v.ok && { components: v.graph.components.map(({ id, kind, value, positiveNode, negativeNode }) => ({ id, kind, value, positiveNode, negativeNode })) }),
        ...(sol && { nodeVoltagesV: sol.voltages, componentCurrentsA: sol.currents }),
      };
  const { raw, event } = await callModel(mode === 'hint' ? hintPrompt(level, hintIndex) : explainPrompt(level), facts);
  if (raw === null) return deterministic(event);

  if (mode === 'hint') {
    const p = z.object({ text: z.string().min(1) }).safeParse(raw);
    // any number could give the answer away -> use the canned hint instead
    if (!p.success || extractNumbers(p.data.text).length)
      return deterministic({ ...event, status: 'error', note: p.success ? 'hint contained numbers; replaced' : 'gemini malformed_output' });
    return { text: p.data.text, grounded: true, ungroundedNumbers: [], trace: [event] };
  }

  const p = explainSchema.safeParse(raw);
  if (!p.success) return deterministic({ ...event, status: 'error', note: 'gemini malformed_output' });
  const allowed = [
    ...Object.values(finding.evidence.numbers),
    ...Object.values(finding.evidence.numbers).map((x) => x * 1e3),
    ...extractNumbers(finding.evidence.statement).map((n) => n.value),
    ...(v.ok && sol ? allowedNumbers(v.graph, sol) : []),
  ];
  const ungroundedNumbers = checkGrounding([p.data.text, ...(p.data.steps ?? []).flatMap((s) => [s.title, s.text])].join('\n'), allowed);
  return { text: p.data.text, ...(p.data.steps && { steps: p.data.steps }), grounded: ungroundedNumbers.length === 0, ungroundedNumbers, trace: [event] };
}
