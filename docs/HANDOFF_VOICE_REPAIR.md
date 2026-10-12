# Handoff: Voice measurement + Repair Studio into main Lab and Probe Guide

For ChatGPT Work (owner of `/lab`, `/probe`, `src/components/**`, `globals.css`). Docs only; no source was edited. Written against main `f77776e`+ (`15b2100`). Post-hackathon work. Claude ships backend + the isolated voice-lab route; Work ships all main-UI integration.

Sources: `lab-workspace.tsx`, `probe-guide.tsx`, `measurement-comparison.tsx`, `circuit-view.tsx`, `src/app/probe/**`, `docs/CINEMATIC_UI_AUDIT.md`, `API_CONTRACT.md`, `MOONSHOT.md`, and `origin/feat/voice-lab-experimental` (`src/app/for-the-larp/voice-lab/{parser,machine}.ts`).

## 1. Integration points

Build one shared client control, `<VoiceMeasure>` (new file `src/components/ohmni/voice-measure.tsx`, Work-owned). It wraps the pure `parser.ts` + `machine.ts` (moved to `src/lib/voice/` as is, Claude-owned, tests included).

| Mount point | Where | What it replaces/augments |
|---|---|---|
| Lab Compare | `lab-workspace.tsx` `.measurement-block` (~L760-785), beside `#measured-vout` input + "Use demo reading" | Adds a mic/typed-phrase row. On commit it calls the existing `setMeasurement(String(v))` and clears `result`/`probeTarget` exactly as the input's `onChange` does. User still presses "Analyze & compare" (no auto-solve). |
| Lab Investigate | `<ProbeGuide>` (~L971), inside `.next-probe` form (`probe-guide.tsx`, `#probe-reading`) | Adds the same control for `step.next.node`. On commit it calls the same path as the form's submit: `update([...observations, {node, volts}])`. |
| `/probe` | `probe-client.tsx` reading form (`input`, "Submit reading", ~L245) | On commit it calls the existing `run([...obs, {node, volts}])`. `ProbeSchematic highlight` already follows `result.next.node`. |

Props (one component, three call sites):
```ts
type VoiceMeasureProps = {
  graph: CircuitGraph;            // nodes resolve ONLY against this graph
  circuitConfirmed: boolean;      // Lab: `confirmed && reviewReady`; /probe: true (graph is fixed sample)
  revision: number;               // bump on ANY graph edit/reset/sample change (Lab: editGraph/reset/importGraph)
  expectedNode?: string;          // Investigate / /probe: result.next.node; Compare: graph.measureNode
  disabled?: boolean;             // pass `pending` / `loading`
  onCommit: (o: { node: string; volts: number; transcript: string }) => void; // called ONLY after user confirmation
  onHighlight?: (node: string | undefined) => void;  // hear a node -> parent sets probeTarget / ProbeSchematic highlight
};
```
Events out: `onHighlight(node)` when a reading is proposed (pre-confirm, a UI hint only, not data); `onCommit` after confirmation. The parent owns observations and all API calls. `<VoiceMeasure>` makes no network calls (the Voice Lab branch's `commitReading` fetch plumbing is not used in the main app; parents already call `/api/solve` and `/api/probe`).

Must NOT change:
- **Confirmation gate.** Voice never confirms a circuit (`commitBlocker`: "Voice never confirms a circuit."). The "Circuit confirmed" checkbox stays click-only. A heard reading is only a proposal until the user says/clicks confirm.
- **Invalidation on edit.** A proposal carries `revision`; if `revision` changed at commit, refuse (existing text: "The circuit changed after this reading was heard. Say the reading again."). Edits still clear confirmation and results.
- **No API calls on stage navigation.** `goTo()` stays pure; `<VoiceMeasure>` must not solve/probe on mount, focus, or stage change. The only network calls remain: Analyze click, Guide me / Update investigation, and the explicit Repair actions in section 2.
- `ProbeGuide`'s `key={JSON.stringify(graph) + measured}` remount and `inFlight` guard; `MeasurementComparison` stays presentational; `hidden={stage !== ...}` panel pattern; stage status `role="status"` focus handoff.
- Mic permission is requested only on a user gesture (push-to-talk). If `SpeechRecognition` is missing or denied, fall back to the typed phrase field (machine `getRecognitionCtor` returns null => typed mode).

## 2. Typed contracts

### 2a. Voice (from `origin/feat/voice-lab-experimental`)
```ts
export type VoiceIntent =
  | { type: "record_measurement"; node: string; value: number; unit: "V" | "mV" }
  | { type: "next_probe" } | { type: "explain_result" } | { type: "show_hypotheses" }
  | { type: "repeat" } | { type: "confirm" } | { type: "cancel" }
  | { type: "unknown"; reason: string };
parseCommand(text: string, graph: CircuitGraph): { intent: VoiceIntent; warning?: string }  // deterministic, no model calls
volts(i): number   // mV -> V
// machine.ts
type Phase = "idle" | "listening" | "processing" | "confirming" | "committed" | "error";
type VLState = { phase; circuitConfirmed: boolean; revision: number; proposal: Proposal | null; observations: Obs[]; message: string };
type Proposal = { reading: Extract<VoiceIntent,{type:"record_measurement"}>; revision: number; warning?: string; transcript: string };
Action = select_circuit | confirm_circuit | listen | heard | propose{proposal} | say{message} | cancel | commit_start | commit_done{observations,message} | fail{message}
reducer(s, a): VLState;  commitBlocker(s): string | null;  addObs(list, o)  // newest reading per node wins
```
Flow: `listen -> heard -> propose (confirming) -> confirm intent or button -> commit_start -> [commitBlocker] -> commit_done`. Nodes resolve only against the graph; ambiguous input becomes `unknown` with a clarification. Spoken replies are built only from confirmed readings plus API output (`groundedReply`); wording is "hypothesis, not a confirmed fault".
Integration note: in the main app, `commit_start`/`commit_done` wrap the parent's `onCommit` (no `commitReading`/`postJSON`).

### 2b. Repair API (implemented on a parallel branch; not on main yet)
`POST /api/repair`, body `{ graph, userConfirmed: true, observations: {node, volts}[] }`:
```ts
type RepairProposal = {
  id: string; hypothesisId: string; title: string;
  faultClass: "open" | "short" | "value" | "source";
  target: { componentId: string };
  probability: number;                       // model-relative, single-fault, assumed priors
  patch: { kind: "restore_design"; componentId: string; faultedValue: number; designValue: number; unit: "ohm" | "volt" };
  supportingObservations: { node: string; measured: number; predictedIfFault: number; predictedIfRepaired: number }[];
  before: { voltages: Record<string, number>; currents: Record<string, number> };  // fault model, SIMULATED
  after:  { voltages: Record<string, number>; currents: Record<string, number> };  // repaired model, SIMULATED
  resolves: boolean; uncertainty: string;
  verification: { instruction: string; node: string; expectVolts: number; toleranceVolts: number };
  actions: string[]; status: "hypothesized";
};
// 200: { result: { proposals: RepairProposal[]; basis: { topHypothesisId: string; topProbability: number; done: boolean }; safety: string; trace: ModelTraceEvent[] } }
```
`POST /api/repair/verify`, body `{ graph, userConfirmed: true, proposal: { hypothesisId, verification }, measured: { node, volts } }`:
```ts
// 200: { result: { verified: boolean; status: "verified" | "not_verified"; delta: number; message: string } }
```
Errors match `/api/solve` and `/api/probe` (400 `BAD_JSON`, 422 `NOT_CONFIRMED`/`INVALID_GRAPH`/`UNSOLVABLE`, 429). No model calls. Work must validate responses client-side like `parseStep` does (finite numbers, probability in [0,1], `status === "hypothesized"`, ids present) and show an error card instead of rendering partial data.
Rules: `currents` in `before`/`after` are solver outputs on a hypothetical model. Never label them measured. Only `verified` can change a badge to VERIFIED.

## 3. Visual spec: Repair Studio (Living Schematic language)

Tokens: ivory `#F6F5F0` (surface), teal `#142C32` (ink/structure), copper `#F2B45A` (highlight/active node), sage `#829E98` (secondary/after-state), fault red `#943E2C` (suspect). Use existing CSS variables where they map; add new ones only in `globals.css` (Work). Tabular numerals everywhere.

- **Suspect component:** `proposal.target.componentId` gets a fault-red 12% fill tint plus 1.5 px red stroke on its symbol in `CircuitView`/`ProbeSchematic` (add `suspectComponentId` prop), with a text label "R6 suspected" (not color alone).
- **Highlighted node:** copper ring (existing `suggested-ring`) for the next probe; copper is never used for faults.
- **Before/after pair:** two equal big numerals (`clamp(36px,4vw,52px)`), left = BEFORE (red numeral, `before.voltages[node]`), right = AFTER (sage/teal numeral, `after.voltages[node]`), arrow between. Reuse the `MeasurementComparison` layout (`comparison-value` dl pairs). Default node: `supportingObservations[0].node`; a select lists the others.
- **Badges (exact copy, uppercase eyebrow style, always shown beside the number):**
  - `MEASURED` , a value the user entered/confirmed. Teal outline.
  - `SIMULATED` , solver output on the confirmed graph (before/after voltages, currents). Sage outline.
  - `HYPOTHESIZED` , a fault proposal (`status:"hypothesized"`) and its probability. Dashed red outline.
  - `VERIFIED` , only after `/api/repair/verify` returns `status:"verified"`. Solid teal fill. `not_verified` shows `NOT VERIFIED` in fault red with `message`.
  Caption under the pair: "Model-relative probability from assumed priors and a single-fault model. Not proof of a fault." Currents always carry `SIMULATED`, never next to a MEASURED badge.
- **Schematic diff overlay:** same `CircuitView` with `result=after`; the patched component shows faultedValue struck through and designValue in teal (`R6: open -> 10 kΩ`); changed node voltages show old value dimmed above new. Toggle "Show fault / Show repaired" (default fault).
- **Verification step:** a card after "Restore R6": `verification.instruction`, a number input for `verification.node`, expected `expectVolts ± toleranceVolts` shown as SIMULATED, submit calls `/api/repair/verify`. Result shows the delta and `message`; no auto-success.
- **Safety:** render `result.safety` verbatim; power-off wording for any physical step in `actions`.
- **Motion:** at most 250 ms, `cubic-bezier(.2,.8,.2,1)`, `transform`/`opacity`/`stroke-dashoffset` only, wrapped in `@media (prefers-reduced-motion: no-preference)` (reduced = final state, no animation, per the audit's global rule). Animate only real state changes: node ring moves when `next.node` changes; probability bars (keyed by `hypothesis.id`) when a reading is committed; after-numerals count up (<=220 ms) when a proposal is selected; overlay swap on toggle. No idle pulses, no looping mic animation beyond a static "Listening" label, no animation that implies live current flow or a measured current.

## 4. Signature interaction sequence

State owner: parent holds `observations`, `revision`, `probeStep` (`/api/probe`), `repair` (`/api/repair`), `verify`. `<VoiceMeasure>` holds only the machine state.

| # | Beat | Component / state | API |
|---|---|---|---|
| 1 | User speaks "C is zero" | `listen`/`heard`; `parseCommand` -> `record_measurement{node:"C",value:0,unit:"V"}`; `propose` | none |
| 2 | Node illuminates | `onHighlight("C")` -> `probeTarget` / `ProbeSchematic highlight`; shows "C = 0 V, confirm?" | none |
| 3 | Confirm ("yes" or button) | `commit_start` (blocker checks confirmed + revision) -> `onCommit` -> parent `update([...obs,{C,0}])` | `/api/probe` (and `/api/solve` with `measuredVoltage` only if node is `graph.measureNode`) |
| 4 | Discrepancy shown | Compare: `MeasurementComparison` (EXPECTED vs `MEASURED`), Δ chip; mismatch gate opens | `/api/solve` |
| 5 | Candidates update | `ProbeGuide` hypothesis bars re-keyed by id; `fitWarning` shown if any | `/api/probe` |
| 6 | Next node highlighted | `step.next.node` -> `onTarget` / `highlight`; mic row retargets (`expectedNode`) | (from step 3) |
| 7 | Second reading ("A is 7.533") | steps 1-3 again; `addObs` replaces same-node readings | `/api/probe` |
| 8 | Repair appears | when `basis.done` or top probability >= threshold, parent calls repair once per `observations` change; `RepairPanel` mounts under hypotheses | `POST /api/repair` |
| 9 | Simulated repaired voltages | proposal card: before/after pair `SIMULATED`, overlay, `HYPOTHESIZED` badge | (from step 8) |
| 10 | User takes physical action, measures, enters/speaks reading | `<VoiceMeasure expectedNode={verification.node}>` -> `onCommit` -> parent | `POST /api/repair/verify` -> `VERIFIED`/`NOT VERIFIED` |

Repair is fetched by explicit state (observations changed and `done`), never on stage navigation; a stale response (observations changed during flight) is discarded using the existing `inFlight`/`active` ref pattern. "Back"/"Next" stage buttons stay API-free. Repair Studio mounts inside the Investigate stage (and in `/probe` below the hypotheses list), not as a fifth stage.

## 5. Acceptance criteria

Testable (Playwright with injected fake `SpeechRecognition` plus typed fallback; vitest for parser/machine):
1. Typed "C is zero" and a fake-STT utterance produce the same proposal; nothing posts to `/api/probe`/`/api/solve`/`/api/repair` before confirm (assert zero requests).
2. Unconfirmed circuit: mic disabled/explains; "yes" never ticks the "Circuit confirmed" checkbox.
3. Edit any component after a proposal appears: confirm is refused with the revision message; nothing is recorded; results/confirmation clear as today.
4. Stage navigation (Capture <-> Review <-> Compare <-> Investigate) issues zero network requests (assert via request log).
5. Mic denied or no `SpeechRecognition`: typed mode works end to end; no uncaught errors.
6. Every number in Repair Studio has exactly one badge from {MEASURED, SIMULATED, HYPOTHESIZED, VERIFIED}; no VERIFIED before a `verified` response; currents never carry MEASURED.
7. Reduced motion: `getAnimations().length === 0` across the whole flow; otherwise every animation <= 250 ms.
8. Axe: no serious/critical; all controls keyboard reachable; suspect state not color-only; 390x844 has no horizontal scroll.
9. Existing e2e (Lab divider, `/probe` ladder, Probe Guide) pass unchanged.

Loaded-bridge demo (`/probe` sample "Loaded bridge", 7 resistors, 12 V, measure C):
1. Say "C is zero" -> node C lights -> confirm. Discrepancy: expected ~2.61 V vs MEASURED 0 V; candidates update.
2. Next node highlighted: A. Say "A is seven point five three three" -> confirm (A = 7.533 V).
3. Candidates collapse: R6 open ~94% (HYPOTHESIZED, model-relative). Repair card appears: "Restore R6", R6 tinted red.
4. After pair for C: BEFORE 0 V (SIMULATED) -> AFTER ~2.61 V (SIMULATED).
5. Click "Restore R6", measure C on the bench, say "C is two point six one" -> `POST /api/repair/verify` -> VERIFIED within `toleranceVolts`.
Exact figures must come from the API; if they differ from this script, the API wins and the script is updated.

## 6. Ownership and sequencing

| Owner | Ships | Paths (exclusive writes) |
|---|---|---|
| Claude | Repair backend (`/api/repair`, `/api/repair/verify`, `src/lib/repair/**`, tests, API_CONTRACT section); voice lib (`parser.ts`, `machine.ts` moved to `src/lib/voice/`, tests); the isolated `/for-the-larp/voice-lab` route and its CSS | `src/app/api/repair/**`, `src/lib/repair/**`, `src/lib/voice/**`, `src/app/for-the-larp/voice-lab/**`, `tests/voice-lab/**`, `tests/repair/**` |
| Work | `<VoiceMeasure>`, `RepairPanel`/Repair Studio, mounts in Lab + `/probe`, CSS tokens/motion, `suspectComponentId` prop on `CircuitView`/`ProbeSchematic` | `src/components/ohmni/**`, `src/app/lab/**`, `src/app/probe/**`, `globals.css`, `probe.css` |

Merge order (each its own PR, rebase on main between):
1. Claude: repair backend + contract doc (no UI). Work can mock responses from the types above.
2. Claude: move voice parser/machine to `src/lib/voice/` (pure, tested; the voice-lab route imports from it).
3. Work: `<VoiceMeasure>` + mount on `/probe` first (lowest risk: its reading form is simplest), then Lab Investigate, then Lab Compare.
4. Work: Repair Studio panel, schematic diff overlay, verification step.
5. Work: motion pass per section 3 and the e2e/axe criteria in section 5.

No overlapping writes: Claude does not touch `src/components/**`, `/lab`, `/probe`, or `globals.css`; Work does not edit `src/lib/{repair,voice,probe,circuit}/**` or API routes. A contract change goes through `docs/API_CONTRACT.md` as its own coordinated PR (existing rule). Nothing here requires new model calls, new dependencies, or deploys.
