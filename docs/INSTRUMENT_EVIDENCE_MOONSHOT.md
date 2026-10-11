# Moonshot A — Instrument Evidence Import

Status: **implemented & tested (library + CLI), experimental, no UI.** Branch `moonshot/instrument-evidence`.

## Purpose

Students lose the thread when they have to read a meter, then type each number into the app. Many
bench multimeters (and their phone apps / loggers) export CSV. This moonshot lets a learner keep
their **hands on the probes**, take readings, and import the whole log afterwards. Every accepted
reading keeps its **provenance** (CSV row, timestamp, instrument, channel, raw line), so a teacher
can see exactly which measurement moved which hypothesis.

Nothing new decides physics: imported readings become plain `{ node, volts }` observations fed to
the existing Probe Guide (`probeStep`, MNA solver) and, for the measure node, `diagnose()`.

## Files

| File | Role |
| --- | --- |
| `src/lib/instrument/csv.ts` | RFC-4180-ish parser (`parseRecords`, `parseCsv`) + `parseVolts` |
| `src/lib/instrument/import.ts` | `importReadings(csvText, graph, opts)` → `ImportResult` |
| `src/lib/instrument/investigate.ts` | `runInvestigation(graph, result)` → per-reading trace; `formatInvestigation`; CLI fixtures |
| `scripts/instrument-demo.mjs` | Offline CLI |
| `fixtures/instrument/*.csv` | **Synthetic** sample exports (first line says so) |
| `tests/instrument/instrument.test.ts` | Parser, units, limits, duplicates, contradictions, integration |

## CSV spec

```csv
# SYNTHETIC — generated for tests, not captured by an instrument
timestamp,node,value,unit,instrument,channel,note
2026-10-11T10:00:00Z,B,0.00,V,DMM-1,CH1,first reading at measure node
2026-10-11T10:00:20Z,A,5.00,V,DMM-1,CH1,probe guide suggested A
2026-10-11T10:00:35Z,b,1.2,mV,DMM-1,CH1,"re-check B, same within tolerance"
```

- **Encoding / syntax:** UTF-8, optional BOM; `,` separator; fields may be `"quoted"` with `""`
  escapes and embedded commas/newlines; CRLF, LF or CR line ends; blank lines ignored; lines whose
  first character is `#` are comments.
- **Header row required** (first non-comment line). Names are trimmed and case-insensitive, any order.
  Unknown columns are ignored with a warning; duplicate known columns are a file error.

| Column | Required | Rules |
| --- | --- | --- |
| `node` | yes | Must match a graph node, case-insensitive (`b` → `B`). `GND` is rejected: it is the black-probe reference, not a target. |
| `value` | yes | Plain decimal, optional sign and exponent (`0.45`, `-1.2`, `4.5e2`). Rejected: `1,5`, `1,000`, `NaN`, `Infinity`, hex, units glued on (`5V`). |
| `unit` | yes | `V` or `mV`, trimmed, case-insensitive. **`MV` is rejected as ambiguous** (megavolts). `kV`, `µV`/`uV`, `A`, `Ω`, `V DC` are rejected. µV is deliberately unsupported: hobby meters don't resolve it and it invites mislabelled data. |
| `timestamp` | no | ISO-8601 (`2026-10-11`, `2026-10-11T10:00`, `…:00.123Z`, `…+02:00`). Invalid → row rejected. |
| `instrument`, `channel`, `note` | no | Free text, kept in provenance. |

mV→V is **exact**: the decimal exponent is shifted before parsing, so `450 mV` and `0.45 V` produce
the identical double (`=== 0.45`).

## Import semantics

- **Row numbers** are 1-based physical lines in the file (what an editor shows). Row `0` = whole file.
- **Order:** by timestamp when every accepted row has one (stable); otherwise file order (+ warning if mixed).
- **Duplicates:** same node, readings within **2 % + 10 mV** (the Probe Guide's own σ) collapse to
  their mean; `rows` lists every merged CSV row.
- **Contradictions:** same node, spread beyond 2 % + 10 mV.
  - `policy: 'reject'` (default): every row for that node is rejected with
    `contradictory readings at <node> (…)`; the rows stay in `provenance`.
  - `policy: 'latest'`: keep the most recent timestamp (file order if untimed) and add a warning.
- **Range check:** `|v| > 1.1 × max source voltage` is accepted with a `check meter range` warning
  (the Probe Guide's `fitWarning` will also flag it if no single fault explains it).

## Limits

| Limit | Value | Behaviour |
| --- | --- | --- |
| Input size | 256 KB (UTF-8 bytes) | whole file rejected (row 0) |
| Data rows | 500 | whole file rejected (row 0) |
| Accepted observations | 50 (probe API cap) | first 50 in order kept; the rest rejected `over the 50-observation probe cap` |

## Safety

- **Offline only.** Pure functions over a string; no network, no model calls (Groq/Gemini/Jev untouched).
- **No actuation.** Nothing talks to an instrument or a supply; import only reads a file the user chose.
- **No energized resistance.** Import accepts only voltages (`V`/`mV`). Resistance (`Ω`) rows are
  rejected; the Probe Guide's existing text still says to disconnect power before using an ohmmeter.
- Results are hypotheses, never confirmed faults (probe/diagnosis wording is reused unchanged).

## How it plugs into the Probe Guide

```ts
import { importReadings } from '@/lib/instrument/import';
import { runInvestigation } from '@/lib/instrument/investigate';
import { probeStep } from '@/lib/probe';

const result = importReadings(csvText, confirmedGraph);          // validated observations + provenance
probeStep(confirmedGraph, result.observations);                  // ImportedObservation ⊇ Observation
const inv = runInvestigation(confirmedGraph, result);            // probeStep on each prefix, in order
```

`runInvestigation` validates the graph (`validateGraph`), then for k = 0…n calls
`probeStep(graph, observations.slice(0, k))`, records the top 3 hypotheses with their change since
the previous step, the biggest gainer/loser, the next suggested probe, and — when the reading is at
`graph.measureNode` — `diagnose(graph, volts)` (which also covers continuous values such as
"R2 ≈ 1 kΩ"). No existing file in `src/` was modified.

## CLI

```sh
node scripts/instrument-demo.mjs fixtures/instrument/ladder_r2_open.csv ladder
node scripts/instrument-demo.mjs fixtures/instrument/divider_r2_1k.csv divider
node scripts/instrument-demo.mjs fixtures/instrument/messy_export.csv ladder --latest
```

Uses Node's built-in type stripping (tested on Node 24.15) with a tiny resolve hook (no `tsx` dependency);
`npx tsx scripts/instrument-demo.mjs …` also works where tsx is available. Fixtures: `ladder`,
`divider`, `series-parallel`.

Example (ladder, truth = R2 open):

```
Step 1: B = 0.0006 V  (rows 4, 6)
    25.0%    +21.2pp  R1 open / not connected
    25.0%    +21.2pp  R2 open / not connected
    25.0%    +21.2pp  R3 shorted (bridge or stray wire)
   next: Measure A next (~1.50 bits expected).
Step 2: A = 5 V  (rows 5)
   100.0%    +75.0pp  R2 open / not connected
   DONE: Most likely: R2 open / not connected (100%).
```

Note for the divider fixture: 450 mV at VOUT leaves **R1 = 100 kΩ** and **R2 = 1 kΩ** tied in the
Probe Guide (same voltage at every node), and it correctly says to check them with power off and an
ohmmeter; `diagnose()` ranks "R2 may be 1 kΩ instead of 10 kΩ" first.

## Typed handoff for ChatGPT Work (future UI — not implemented here)

```ts
// src/lib/instrument/import.ts
export type ImportPolicy = 'reject' | 'latest';
export type ImportOptions = { policy?: ImportPolicy };
export type ReadingProvenance = {
  row: number; node: string; volts: number;
  timestamp?: string; instrument?: string; channel?: string; note?: string;
  raw: string;
};
export type ImportedObservation = { node: string; volts: number; rows: number[]; timestamp?: string };
export type RejectedRow = { row: number; reason: string };
export type ImportResult = {
  observations: ImportedObservation[];
  provenance: ReadingProvenance[];
  rejected: RejectedRow[];
  warnings: string[];
};
export function importReadings(csvText: string, graph: CircuitGraph, opts?: ImportOptions): ImportResult;

// src/lib/instrument/investigate.ts
export type HypothesisSnapshot = { id: string; title: string; probability: number; delta: number };
export type InvestigationStep = {
  index: number;                       // 0 = prior, before any reading
  added: ImportedObservation | null;
  observations: Observation[];         // prefix fed to probeStep
  top: HypothesisSnapshot[];           // top 3; delta vs previous step
  gained: HypothesisSnapshot | null;
  lost: HypothesisSnapshot | null;
  next: { node: string; expectedBits: number; instruction: string } | null;
  done: boolean;
  reason: string;
  fitWarning?: string;
  diagnosis?: { title: string; rationale: string; nextMeasurement: string }[];
};
export type Investigation = { steps: InvestigationStep[]; safety: string } | { error: string };
export function runInvestigation(graph: CircuitGraph, imported: ImportResult): Investigation;
```

Everything is pure and browser-safe (`TextEncoder`, no `fs`), so the UI can call it client-side on
the confirmed graph — no new API route needed.

Suggested UI (for Work to build):

1. **Drop zone** on the Probe page after the graph is confirmed: drag-drop or pick a `.csv`
   (read with `File.text()`); a "policy" toggle (reject contradictions / keep latest).
2. **Import summary:** "2 readings imported from 3 rows" + warnings; a **rejected-rows table**
   (`row`, `reason`, and the `raw` line from the file) so the student can fix the export.
3. **Evidence timeline:** one card per `InvestigationStep` with horizontal **hypothesis bars**
   (probability, ▲/▼ delta), the reading that caused it, its provenance chips (instrument, channel,
   time, CSV rows), the `fitWarning` in amber, and `diagnosis` titles when present.
4. Final card shows `next.instruction` (continue live probing) or `reason` when `done`, plus `safety`.

## Future

- **SCPI read-only meters** (USB-TMC / LAN): poll `MEAS:VOLT:DC?` only — never `SOUR`/`OUTP`
  commands — and emit the same `ReadingProvenance` rows, so `importReadings` stays the single gate.
- Per-instrument accuracy (e.g. `±(0.5 % + 2 digits)`) from an `accuracy` column instead of the
  fixed 2 % + 10 mV.
- Known export dialects (vendor apps with `;` separators and decimal commas) via explicit presets,
  never by guessing.
