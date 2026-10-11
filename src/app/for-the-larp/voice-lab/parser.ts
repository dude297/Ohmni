import type { CircuitGraph } from "../../../lib/circuit/types";

// Typed, deterministic voice/text command parser. No model calls. Nodes resolve ONLY against the
// current graph; anything ambiguous comes back as `unknown` with a clarification question.

export type VoiceIntent =
  | { type: "record_measurement"; node: string; value: number; unit: "V" | "mV" }
  | { type: "next_probe" }
  | { type: "explain_result" }
  | { type: "show_hypotheses" }
  | { type: "repeat" }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "unknown"; reason: string };

export type Parsed = { intent: VoiceIntent; warning?: string };

const UNITS: Record<string, number> = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// STT homophones for digits ("to"/"for" are deliberately NOT mapped: "point to B" would become a number).
const HOMOPHONES: Record<string, string> = { won: "one", tree: "three", fife: "five", niner: "nine", nought: "zero", naught: "zero" };
const isNumWord = (w: string) => w in UNITS || w in TEENS || w in TENS || w === "hundred" || w === "point";
const isDigits = (w: string) => /^\d*\.?\d+$/.test(w);

export const volts = (i: { value: number; unit: "V" | "mV" }) => (i.unit === "mV" ? i.value / 1000 : i.value);
export const fmtNum = (v: number) => `${Math.abs(v) < 1e-9 ? 0 : +v.toPrecision(4)}`;
export const fmtReading = (i: { value: number; unit: "V" | "mV" }) =>
  i.unit === "mV" ? `${fmtNum(i.value)} mV (${fmtNum(volts(i))} V)` : `${fmtNum(i.value)} V`;

export function graphNodes(g: CircuitGraph): string[] {
  const s = new Set<string>();
  for (const c of g.components) s.add(c.positiveNode).add(c.negativeNode);
  return [...s];
}
export const maxSupply = (g: CircuitGraph) =>
  Math.max(0, ...g.components.filter((c) => c.kind === "dc_voltage").map((c) => Math.abs(c.value)));

/** Integer from number words; null = ambiguous ("four five", "twenty thirty"). */
function wordsToInt(ws: string[]): number | null {
  let total = 0;
  let last: "unit" | "teen" | "tens" | "hundred" | null = null;
  for (const w of ws) {
    if (w in UNITS) {
      if (last === "unit" || last === "teen") return null;
      total += UNITS[w];
      last = "unit";
    } else if (w in TEENS) {
      if (last && last !== "hundred") return null;
      total += TEENS[w];
      last = "teen";
    } else if (w in TENS) {
      if (last && last !== "hundred") return null;
      total += TENS[w];
      last = "tens";
    } else if (w === "hundred") {
      if (last === "hundred" || total >= 100) return null;
      total = (total || 1) * 100;
      last = "hundred";
    } else return null;
  }
  return ws.length ? total : null;
}

/** One spoken number span -> value; null = ambiguous. */
function spanToNumber(ws: string[]): number | null {
  if (ws.length === 1 && isDigits(ws[0])) return Number(ws[0]);
  const p = ws.indexOf("point");
  if (p === -1) return wordsToInt(ws);
  if (ws.indexOf("point", p + 1) !== -1) return null;
  const intPart = ws.slice(0, p);
  const frac = ws.slice(p + 1);
  const i = intPart.length === 0 ? 0 : intPart.length === 1 && isDigits(intPart[0]) ? Number(intPart[0]) : wordsToInt(intPart);
  if (i === null || frac.length === 0) return null;
  let digits = "";
  if (frac.length === 1 && /^\d+$/.test(frac[0])) digits = frac[0];
  else if (frac.every((w) => w in UNITS)) digits = frac.map((w) => UNITS[w]).join("");
  else {
    // "point forty five" -> .45 (the only reading of a tens-word after "point")
    const n = wordsToInt(frac);
    if (n === null || n >= 100) return null;
    digits = String(n);
  }
  return Number(`${i}.${digits}`);
}

function normalize(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/(\d),(\d{3})\b/g, "$1$2")
      .replace(/(\d)\s*(millivolts?|mv|volts?|v)\b/g, "$1 $2")
      .replace(/[^a-z0-9.\s-]/g, " ")
      .replace(/(^|\s)-(?=\d)/g, "$1minus ")
      .replace(/-/g, " ")
      .replace(/\.(?!\d)/g, " ")
      .replace(/\bmilli\s+volts?\b/g, "millivolts")
      // "v out" / "vee out" / "v in" -> vout / vin
      .replace(/\b(v|vee|vi|we)\s+(out|in)\b/g, "v$2")
      .replace(/\bground\b/g, "gnd")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const PHRASES: [RegExp, VoiceIntent["type"]][] = [
  [/^(yes|yeah|yep|yup|correct|confirm|confirmed|that s right|thats right|right|affirmative)$/, "confirm"],
  [/^(no|nope|cancel|wrong|stop|scratch that|never mind|nevermind|incorrect)$/, "cancel"],
  [/^(repeat|say (that|it) again|again|come again|what did you say)$/, "repeat"],
  [/^(next|next probe|next step|where next|what next|where (should|do) i (probe|measure)( next)?|what should i measure( next)?|where now)$/, "next_probe"],
  [/^(explain|explain (that|this|it|the result|result)|why|tell me why)$/, "explain_result"],
  [/^((show|list|read)( me)?( the)? (hypotheses|suspects|faults)|hypotheses|suspects|what s wrong|whats wrong)$/, "show_hypotheses"],
];

const STOP = new Set(["node", "is", "at", "on", "reads", "reading", "read", "equals", "measures", "measured", "i", "get", "got", "the", "of", "it", "s", "and", "about", "shows", "showing", "was", "has", "volts", "volt", "v", "millivolts", "millivolt", "mv", "minus", "negative", "probe", "red", "black", "meter", "my", "say", "says", "its", "um", "uh", "so", "ok", "okay", "with", "to", "gnd", "that", "this", "voltage", "value", "there", "here"]);

export function parseCommand(text: string, graph: CircuitGraph): Parsed {
  const t = normalize(text);
  const unknown = (reason: string): Parsed => ({ intent: { type: "unknown", reason } });
  if (!t) return unknown("I didn't catch anything. Try \"VOUT is 0.45 volts\".");
  for (const [re, type] of PHRASES) if (re.test(t)) return { intent: { type } as VoiceIntent };

  const nodes = graphNodes(graph);
  const nodeList = nodes.filter((n) => n !== graph.groundNode).join(", ");
  const byKey = new Map(nodes.map((n) => [n.toLowerCase(), n]));
  const words = t.split(" ").map((w) => HOMOPHONES[w] ?? w);

  // --- node ---
  const found: { node: string; idx: number }[] = [];
  let unknownNode: string | null = null;
  words.forEach((w, idx) => {
    const n = byKey.get(w);
    if (!n) return;
    // A one-letter node "a" collides with the article: count it only when explicitly addressed
    // ("node a", "at a", sentence-initial "a is/reads ...", or trailing "... at a").
    if (w === "a") {
      const prev = words[idx - 1];
      const next = words[idx + 1];
      const addressed = prev === "node" || prev === "at" || prev === "on" || (idx === 0 && (!next || /^(is|reads|equals|at|was|measures|shows)$/.test(next) || isNumWord(next) || isDigits(next)));
      if (!addressed) return;
    }
    found.push({ node: n, idx });
  });
  const named = t.match(/\bnode (\w+)/)?.[1] ?? t.match(/\b(?:at|on) (\w+)/)?.[1] ?? t.match(/^(\w+) (?:is|reads|equals|measures|shows)\b/)?.[1];
  if (named && !byKey.has(named) && !isNumWord(named) && !isDigits(named) && !STOP.has(named) && !(named in HOMOPHONES))
    unknownNode = named.toUpperCase();
  const distinct = [...new Set(found.map((f) => f.node))];
  if (distinct.length === 0 && unknownNode)
    return unknown(`I don't see a node "${unknownNode}" in this circuit. Which node: ${nodeList}?`);
  if (distinct.length > 1) return unknown(`I heard more than one node (${distinct.join(", ")}). Give one reading at a time.`);
  const node = distinct[0];

  // --- number ---
  const nodeIdx = new Set(found.map((f) => f.idx));
  const spans: string[][] = [];
  let cur: string[] = [];
  let negative = false;
  words.forEach((w, idx) => {
    const numeric = !nodeIdx.has(idx) && (isNumWord(w) || isDigits(w));
    if (numeric) {
      if (cur.length && isDigits(w) && cur.at(-1) !== "point") {
        spans.push(cur);
        cur = [];
      }
      cur.push(w);
    } else {
      if (cur.length) spans.push(cur);
      cur = [];
      if ((w === "minus" || w === "negative") && spans.length === 0) negative = true;
    }
  });
  if (cur.length) spans.push(cur);
  // A bare "o"/"oh" outside a number span is a letter, not zero.
  const real = spans.filter((s) => !(s.length === 1 && (s[0] === "o" || s[0] === "oh")));

  const hasV = /\b(volts?|v)\b/.test(t);
  const hasMv = /\b(millivolts?|mv)\b/.test(t);

  if (real.length === 0) {
    if (node || hasV || hasMv) return unknown(`I didn't catch a number${node ? ` for ${node}` : ""}. Say it like "${node ?? graph.measureNode} is 0.45 volts".`);
    return unknown(`I didn't understand "${text.trim()}". Try "${graph.measureNode} is 2.5 volts", "next", "explain", or "repeat".`);
  }
  if (real.length > 1) return unknown(`I heard more than one number (${real.map((s) => s.join(" ")).join(" / ")}). Please say a single reading.`);
  const n = spanToNumber(real[0]);
  if (n === null || !Number.isFinite(n))
    return unknown(`"${real[0].join(" ")}" is ambiguous. Say it like "zero point four five volts" or "forty five volts".`);
  const value = negative ? -n : n;

  if (!node) return unknown(`Which node is ${fmtNum(value)}${hasMv ? " mV" : hasV ? " V" : ""} at? Nodes: ${nodeList}.`);
  if (node === graph.groundNode) return unknown(`${node} is the reference (black probe). Put the red probe on one of: ${nodeList}.`);
  if (hasV && hasMv) return unknown("I heard both volts and millivolts. Which one?");
  if (!hasV && !hasMv && value !== 0) return unknown(`Is that ${fmtNum(value)} volts or ${fmtNum(value)} millivolts at ${node}?`);
  const unit: "V" | "mV" = hasMv ? "mV" : "V";

  const intent = { type: "record_measurement" as const, node, value, unit };
  const limit = maxSupply(graph) * 1.1;
  const warning =
    Math.abs(volts(intent)) > limit
      ? `Check your range: ${fmtReading(intent)} is beyond this circuit's ${fmtNum(maxSupply(graph))} V supply. Did you mean a different value or unit?`
      : undefined;
  return { intent, warning };
}
