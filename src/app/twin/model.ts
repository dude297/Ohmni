// Pure helpers for /twin: netlist parsing, value formatting, layout, CSV, badges, diff model. No fabricated data.
export type Comp = { id: string; kind: "resistor" | "dc_voltage"; value: number; positiveNode: string; negativeNode: string };
export type Graph = { schemaVersion: 1; components: Comp[]; groundNode: "GND"; measureNode: string };
export type Obs = { node: string; volts: number };
export type CompDiff = {
  componentId: string;
  kind: "value" | "missing_in_observed" | "extra_in_observed" | "kind_changed";
  intended?: { kind: string; value: number };
  observed?: { kind: string; value: number };
  ratio?: number;
};
export type ConnDiff = { componentId: string; terminal: "positive" | "negative"; intendedNode: string; observedNode: string };
export type Diff = { componentDiffs: CompDiff[]; connectionDiffs: ConnDiff[]; nodeMap?: unknown; identical: boolean; uncertainties?: unknown };

// ponytail: inline fixture text (same circuit as LOADED_BRIDGE_12V); a pin-1/pin-2 KiCad subset is all the parser handles.
const NETS: [string, [string, number][]][] = [
  ["VIN", [["V1", 1], ["R1", 1], ["R3", 1]]],
  ["A", [["R1", 2], ["R2", 1], ["R5", 1]]],
  ["B", [["R3", 2], ["R4", 1], ["R5", 2], ["R6", 1]]],
  ["C", [["R6", 2], ["R7", 1]]],
  ["GND", [["V1", 2], ["R2", 2], ["R4", 2], ["R7", 2]]],
];
const COMPS: [string, string][] = [["V1", "12V"], ["R1", "1k"], ["R2", "2k"], ["R3", "1.5k"], ["R4", "1k"], ["R5", "3.3k"], ["R6", "680"], ["R7", "1.2k"]];
export const BRIDGE_NETLIST = `(export (version "E")
  (design (source "loaded_bridge.kicad_sch") (tool "Eeschema"))
  (components
${COMPS.map(([r, v]) => `    (comp (ref "${r}") (value "${v}"))`).join("\n")}
  )
  (nets
${NETS.map(([n, pins], i) => `    (net (code "${i + 1}") (name "${n}") ${pins.map(([r, p]) => `(node (ref "${r}") (pin "${p}"))`).join(" ")})`).join("\n")}
  )
)
`;
export const MAX_NETLIST_BYTES = 64 * 1024;

function mult(s: string) {
  if (s === "m") return 1e-3;
  if (s === "M" || s.toLowerCase() === "meg") return 1e6;
  if (s === "u" || s === "µ") return 1e-6;
  if (s === "R") return 1;
  return 1e3;
}
export function parseValue(raw: string): number | null {
  const t = raw.trim().replace(/Ω|\s|ohms?$|v$/gi, "");
  let m = /^(\d+)([kKMR])(\d+)$/.exec(t); // 4k7
  if (m) return Number(`${m[1]}.${m[3]}`) * mult(m[2]);
  m = /^(\d*\.?\d+)(meg|[kKMmuµR])?$/i.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * (m[2] ? mult(m[2]) : 1);
  return Number.isFinite(v) && v > 0 ? v : null;
}
const trim = (n: number) => String(Number(n.toPrecision(4)));
export function formatValue(v: number, kind: string = "resistor"): string {
  if (kind === "dc_voltage") return `${trim(v)} V`;
  if (v >= 1e6) return `${trim(v / 1e6)} MΩ`;
  if (v >= 1e3) return `${trim(v / 1e3)} kΩ`;
  return `${trim(v)} Ω`;
}
export const formatVolts = (v: number) => `${v.toFixed(3)} V`;

export function parseKicadNetlist(text: string, measureNode = "C"): { graph?: Graph; error?: string } {
  if (new TextEncoder().encode(text).length > MAX_NETLIST_BYTES) return { error: "Netlist is over the 64 KB limit." };
  const vals = new Map<string, string>();
  for (const m of text.matchAll(/\(comp\s+\(ref\s+"?([^")\s]+)"?\)\s*\(value\s+"?([^")]+?)"?\)/g)) vals.set(m[1], m[2]);
  if (!vals.size) return { error: "No (comp ...) entries found. Paste a KiCad .net export." };
  const pins = new Map<string, { pos?: string; neg?: string }>();
  for (const chunk of text.split(/\(net\s+/).slice(1)) {
    const name = /\(name\s+"?([^")]+?)"?\)/.exec(chunk)?.[1]?.replace(/^\//, "");
    if (!name) continue;
    for (const n of chunk.matchAll(/\(node\s+\(ref\s+"?([^")\s]+)"?\)\s*\(pin\s+"?([^")\s]+)"?\)/g)) {
      const e = pins.get(n[1]) ?? {};
      if (n[2] === "1") e.pos = name;
      else if (n[2] === "2") e.neg = name;
      pins.set(n[1], e);
    }
  }
  const components: Comp[] = [];
  for (const [id, raw] of vals) {
    const kind = id[0] === "V" ? "dc_voltage" : id[0] === "R" ? "resistor" : null;
    if (!kind) return { error: `Unsupported part ${id}: only R and V parts are supported.` };
    const value = parseValue(raw);
    const p = pins.get(id);
    if (value === null) return { error: `Cannot read value "${raw}" for ${id}.` };
    if (!p?.pos || !p.neg) return { error: `${id} needs pins 1 and 2 on named nets.` };
    components.push({ id, kind, value, positiveNode: p.pos, negativeNode: p.neg });
  }
  if (!components.some((c) => c.positiveNode === "GND" || c.negativeNode === "GND")) return { error: "No net named GND." };
  return { graph: { schemaVersion: 1, components, groundNode: "GND", measureNode } };
}

// ---- observed table -> graph
export type Row = { id: string; kind: Comp["kind"]; value: string; pos: string; neg: string };
export const rowsFromGraph = (g: Graph): Row[] =>
  g.components.map((c) => ({ id: c.id, kind: c.kind, value: String(c.value), pos: c.positiveNode, neg: c.negativeNode }));
export function graphFromRows(rows: Row[], measureNode: string): { graph?: Graph; error?: string } {
  const components: Comp[] = [];
  for (const r of rows) {
    const value = parseValue(r.value);
    if (value === null) return { error: `${r.id}: "${r.value}" is not a valid value.` };
    if (!r.pos.trim() || !r.neg.trim()) return { error: `${r.id}: both terminals need a node.` };
    components.push({ id: r.id, kind: r.kind, value, positiveNode: r.pos.trim(), negativeNode: r.neg.trim() });
  }
  return { graph: { schemaVersion: 1, components, groundNode: "GND", measureNode } };
}
export type Scenario = "value" | "wiring";
// EXAMPLE scenarios: edit the OBSERVED table only (always start again from the design rows).
export function applyScenario(base: Row[], s: Scenario | null): Row[] {
  return base.map((r) => {
    if (r.id !== "R6" || !s) return r;
    return s === "value" ? { ...r, value: "6800" } : { ...r, neg: "GND" };
  });
}

// ---- bridge layout
export type Seg = { x1: number; y1: number; x2: number; y2: number };
export const RAIL_Y = { VIN: 40, GND: 300 } as const;
export const BRIDGE_LAYOUT: Record<string, Seg> = {
  V1: { x1: 60, y1: 40, x2: 60, y2: 300 },
  R1: { x1: 150, y1: 40, x2: 150, y2: 170 },
  R2: { x1: 150, y1: 170, x2: 150, y2: 300 },
  R3: { x1: 300, y1: 40, x2: 300, y2: 170 },
  R4: { x1: 300, y1: 170, x2: 300, y2: 300 },
  R5: { x1: 150, y1: 170, x2: 300, y2: 170 },
  R6: { x1: 300, y1: 170, x2: 420, y2: 170 },
  R7: { x1: 420, y1: 170, x2: 420, y2: 300 },
};
export const NODE_POINT: Record<string, [number, number]> = { A: [150, 170], B: [300, 170], C: [420, 170] };
export const hasBridgeLayout = (g: Graph) =>
  g.components.length === 8 &&
  g.components.every((c) => c.id in BRIDGE_LAYOUT) &&
  ["VIN", "A", "B", "C"].every((n) => g.components.some((c) => c.positiveNode === n || c.negativeNode === n));
export const terminalPoint = (id: string, t: "positive" | "negative"): [number, number] | null => {
  const s = BRIDGE_LAYOUT[id];
  return s ? (t === "positive" ? [s.x1, s.y1] : [s.x2, s.y2]) : null;
};
// Dashed re-routed lead from a component terminal to its observed node.
export function reroutePath(id: string, t: "positive" | "negative", node: string): string | null {
  const from = terminalPoint(id, t);
  if (!from) return null;
  const [x, y] = from;
  const off = x + 36;
  if (node in RAIL_Y) return `M${x} ${y} H${off} V${RAIL_Y[node as keyof typeof RAIL_Y]}`;
  const to = NODE_POINT[node];
  return to ? `M${x} ${y} H${off} V${to[1] - 24} H${to[0]} V${to[1]}` : null;
}
/** Real junctions: points where 3+ component terminals meet. */
export function junctions(g: Graph): [number, number][] {
  const pts = new Map<string, { p: [number, number]; n: number }>();
  for (const c of g.components)
    for (const t of ["positive", "negative"] as const) {
      const p = terminalPoint(c.id, t);
      if (!p) continue;
      const k = p.join(",");
      pts.set(k, { p, n: (pts.get(k)?.n ?? 0) + 1 });
    }
  return [...pts.values()].filter((e) => e.n >= 3).map((e) => e.p);
}

/** Rail extents + tap dots: a dot only where the rail continues on both sides (T-junction), never at corners. */
export function railTaps(g: Graph, extra: [number, number][] = []) {
  return (["VIN", "GND"] as const).map((rail) => {
    const y = RAIL_Y[rail];
    const pts = [...g.components.flatMap((c) => (["positive", "negative"] as const).map((t) => terminalPoint(c.id, t))), ...extra];
    const xs = [...new Set(pts.filter((p): p is [number, number] => !!p && p[1] === y).map((p) => p[0]))].sort((a, b) => a - b);
    const [x1, x2] = [xs[0] ?? 60, xs[xs.length - 1] ?? 60];
    return { rail, y, x1, x2, dots: xs.filter((x) => x > x1 && x < x2) };
  });
}

// ---- diff rendering model
export type DiffModel = {
  valueTints: Record<string, string>; // componentId -> "680 Ω → 6.8 kΩ"
  reroutes: { componentId: string; terminal: "positive" | "negative"; from: string; to: string; label: string }[];
  structural: string[];
};
export function diffModel(d: Diff | undefined | null): DiffModel {
  const m: DiffModel = { valueTints: {}, reroutes: [], structural: [] };
  if (!d) return m;
  for (const c of d.componentDiffs ?? []) {
    if (c.kind === "value" && c.intended && c.observed) m.valueTints[c.componentId] = `${formatValue(c.intended.value, c.intended.kind)} → ${formatValue(c.observed.value, c.observed.kind)}`;
    else if (c.kind === "missing_in_observed") m.structural.push(`${c.componentId} missing in observed`);
    else if (c.kind === "extra_in_observed") m.structural.push(`${c.componentId} extra in observed`);
    else m.structural.push(`${c.componentId} changed kind`);
  }
  for (const c of d.connectionDiffs ?? [])
    m.reroutes.push({ componentId: c.componentId, terminal: c.terminal, from: c.intendedNode, to: c.observedNode, label: `${c.componentId}${c.terminal === "positive" ? "+" : "−"} : ${c.intendedNode} → ${c.observedNode}` });
  return m;
}

// ---- CSV evidence (client-side only)
export function parseEvidenceCsv(text: string): { observations: Obs[]; errors: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errors: string[] = [];
  if (!lines.some((l) => l.startsWith("#") && /synthetic/i.test(l))) errors.push("File must carry a '# SYNTHETIC ...' comment line; real instrument data is not accepted here.");
  const rows = lines.filter((l) => !l.startsWith("#"));
  const head = rows.shift()?.toLowerCase().replace(/\s/g, "");
  if (head !== "node,value,unit") errors.push("Header must be: node,value,unit");
  const observations: Obs[] = [];
  if (!errors.length)
    rows.forEach((l, i) => {
      const [node, v, unit = "V"] = l.split(",").map((s) => s.trim());
      const n = Number(v);
      const f = unit === "V" ? 1 : unit === "mV" ? 1e-3 : NaN;
      if (!node || v === "" || !Number.isFinite(n) || !Number.isFinite(f)) errors.push(`Row ${i + 1}: expected node,number,V|mV`);
      else observations.push({ node, volts: n * f });
    });
  return { observations: errors.length ? [] : observations, errors };
}

// ---- badges
export const intendedBadge = (kind?: string) => `INTENDED (source: ${kind === "kicad_netlist" || !kind ? "KiCad netlist" : kind.replace(/_/g, " ")})`;
export const observedBadge = (kind: "human_review" | "image_extraction" | "manual" = "human_review") =>
  ({ human_review: "OBSERVED (human-reviewed)", image_extraction: "OBSERVED (image extraction, reviewed)", manual: "OBSERVED (manual entry)" })[kind];
export type Source = "typed" | "file";
export const evidenceBadge = (s: Source) => (s === "file" ? "FILE EVIDENCE" : "MEASURED");
/** Before/after tables: only nodes the user supplied are MEASURED; everything else is SIMULATED. */
export const valueBadge = (node: string, measured: Record<string, Source>) => (node in measured ? evidenceBadge(measured[node]) : "SIMULATED");
export const verifyBadge = (r: { verified?: boolean; status?: string } | null | undefined) =>
  !r ? null : r.verified === true && r.status === "verified" ? "VERIFIED" : "NOT VERIFIED";
