# Research roadmap briefs (post-hackathon)

Every item here is **planned/research**: nothing below is implemented or claimed in the demo. Written 2026-10-11 against main `947eb06`.

Fixed constraints for all items:
- `CircuitGraph` v1 (`src/lib/circuit/types.ts`: `resistor` | `dc_voltage`, `GND`, `measureNode`) is the single math contract.
- Local MNA (`solveDC`) is the only math authority.
- `userConfirmed` gates `/api/solve`, `/api/probe` and `/api/explain`.
- Models read and route; they never compute.

## 1. Firmware / electrical reconciliation
- **Problem:** On MCU boards, the firmware's pin configuration (pull-ups, ADC dividers, output levels) implies electrical facts the schematic photo does not show. Today a mismatch is invisible.
- **Approach:**
  - Parse a *declared* pin map, not arbitrary firmware. Start with Arduino `pinMode`/`analogRead`, ESP-IDF `gpio_config`, or a small YAML the user writes.
  - Turn it into graph constraints: an internal pull-up adds a resistor (e.g. ~20–50 kΩ, a datasheet range) to VCC, and an ADC pin becomes a `measureNode`.
  - Solve, then diff the result against the firmware's expectations (thresholds, `analogRead` scaling).
  - Static parsing only, with no code execution.
- **Smallest PoC:** a YAML pin map plus a pure function that adds pull-up resistors to a confirmed graph, with a test showing that the VOUT shift explains a "reads 3.1 V instead of 2.5 V" case.
- **Risks:**
  - Pull-up values vary widely, so they need range-valued components; v1 has scalar values only.
  - Firmware parsing is a rabbit hole.
  - The graph cannot model MCU pins as active devices (out of contract).
- **Status:** research.

## 2. Breadboard / CAD / netlist adapters → CircuitGraph
- **Problem:** Engineers already have netlists. Re-extracting them from photos throws information away.
- **Approach:** add deterministic importers that **reject** anything outside v1 instead of approximating it:
  - **SPICE:** `R<name> n1 n2 value` and `V<name> n+ n- DC value`. Map node `0` to `GND`, parse SI suffixes (`k`, `meg`, `m`).
  - **KiCad:** the `.net` S-expression export (`(net (code) (name) (node (ref R1) (pin 1)))`). Map R*/V* refs using footprint/value fields.
  - **Breadboard:** a template mapping row/rail strips to nodes (`inputKind: 'breadboard_template'` already exists in the contract).
  - Imported graphs still pass `validateGraph` and the human confirmation step. Provenance is `"imported: file.cir sha256"`, not a model trace.
- **Smallest PoC:** `parseSpice(text): {graph} | {errors}` covering R and V DC only, tested against the two known voltage cases. KiCad comes second.
- **Risks:**
  - Real netlists contain caps, diodes and subcircuits. Rejecting them is honest but limits coverage.
  - KiCad pin numbering for sources is footprint-specific, so the measure node must be chosen by the user.
- **Status:** planned (SPICE), research (KiCad, breadboard).

## 3. Instrument-connected investigations (SCPI / USB multimeters)
- **Problem:** Typed meter readings are slow and error-prone, and the probe guide (`/api/probe`) would benefit from direct readings.
- **Approach:**
  - **Read-only measurement** via WebSerial/WebUSB in the browser (Chromium only), or a small local bridge.
  - SCPI `MEAS:VOLT:DC?` / `MEAS:RES?` for bench DMMs. Vendor serial protocols for handheld meters are research.
  - Ohmni never *sources* power or switches instruments. No `OUTP ON`, no supply control.
  - Every reading shows on screen and the user accepts it before it becomes an `Observation`, which keeps the human in the loop and lets them catch range or probe errors.
- **Safety:**
  - Low-voltage DC only (the existing `SAFETY` string).
  - Refuse to proceed if a reading exceeds 30 V DC.
  - Do not guide mains or high-energy work. This is a hard product rule, not a setting.
- **Smallest PoC:** a WebSerial page that reads one SCPI value from a DMM and fills the probe observation field. A mock transport is used in tests.
- **Risks:** browser and API support, a wide variety of meter protocols, and liability if users over-trust automation.
- **Status:** research.

## 4. Multi-sheet designs
- **Problem:** Real schematics span sheets that are joined by net labels and off-page connectors. Today one image means one graph.
- **Approach:**
  - Extract per sheet, keeping net labels as node names.
  - Merge sheets deterministically by label (case-normalised, the same `up()` as in `crossings.ts`).
  - Unmatched labels become `unresolvedConnections`, and the merge is shown to the user before confirmation.
- **Smallest PoC:** a pure `mergeSheets(graphs[])` with label collision and dangling-label tests, using hand-written graphs (no vision).
- **Risks:**
  - The same label can mean different nets in hierarchical sheets.
  - Graph size grows past what a human can review in one screen.
  - Vision cost scales with the number of sheets.
- **Status:** research.

## 5. Evidence and provenance graph
- **Problem:** "Why does Ohmni believe J3 is open?" is currently spread across the trace, warnings and UI state.
- **Approach:**
  - Use an append-only event list per investigation: `{id, kind: model_read | crop_check | human_choice | measurement | import, subject: componentId | nodeId | junctionId, claim, source: {provider, model, prompt_version} | {user} | {instrument}, ts, supersedes?}`.
  - The status of each graph element is derived from this list using the wording ladder in TOPOLOGY_NEXT §(b).
  - Export it as JSON alongside the report.
  - Anbaric's audited jobs are one candidate store for this (see ANBARIC_WORKFLOW.md); a JSON column in Postgres would also work.
- **Smallest PoC:** an in-memory `EvidenceLog` plus a pure `statusOf(element)` with tests, rendered as a "why?" popover.
- **Risks:** schema churn, and privacy (images and hashes must not leak into logs without consent).
- **Status:** planned.

## 6. Safe multimodal measurement capture (and voice, later)
- **Problem:** The user's hands hold probes, so typing readings is awkward.
- **Approach, in order:**
  1. **Photo of the meter display**, read by a vision model into `{value, unit, mode}`. The user must tap to accept; the parsed unit and mode must match the expected `mode` (V vs Ω); and the reading is rejected if it is outside 3σ of every hypothesis without an explicit override.
  2. Instrument link (item 3).
  3. **Voice later.**
- **Why not voice now:**
  - It adds a speech provider (cost, quota and privacy).
  - Misheard numbers ("fifteen" vs "fifty", "k" vs "m") are high-impact errors in exactly the field we trust most.
  - It needs a confirm step anyway, which removes most of the hands-free benefit.
  - Noisy benches make it unreliable to demo.
  - It is not in the free-tier model budget (docs/MODEL_ACCESS.md).
- **Smallest PoC:** offline evaluation of display-photo reading on 30 labelled meter photos, reported with Wilson intervals (TOPOLOGY_NEXT §c). No UI until accuracy is measured.
- **Risks:** a 7-segment misread (1 vs 7, decimal point), hidden auto-range unit changes, and glare.
- **Status:** research.
