# Moonshot: Probe Guide (next-best-measurement)

Status: shipped. Backend `POST /api/probe` + `src/lib/probe` (PR #25); standalone UI at `/probe` with the grounded tutor (PR #33); in-lab Probe Guide (`src/components/ohmni/probe-guide.tsx`, PR #35).

## Pitch
One bad reading doesn't tell you which part failed. Probe Guide tells you **where to put the red probe next**.
It works through every single-fault hypothesis with the MNA solver, picks the node whose reading
splits those hypotheses the most (expected information gain, in bits), and updates after each reading until one fault is left.
It's the lab TA asking "ok, now what does node A read?", and it gets its numbers from the solver, not from a model.

## Scoring (1-5, higher is better; "risk" = 5 means lowest risk to main flow)

| Feature | Demo wow | Differentiation | Feasible ~90 min | Low risk to main flow | Multimodel essential |
|---|---|---|---|---|---|
| **Probe Guide (info-gain next measurement, iterative)** | 4 | 5 | 5 | 5 | 2 |
| Virtual breadboard + union-find → CircuitGraph | 4 | 3 | 3 | 4 | 1 |
| Breadboard *photo* → holes → graph (Gemini) | 5 | 4 | 1 | 2 | 5 |
| Multi-measurement fault localization (batch, no guidance) | 2 | 3 | 5 | 5 | 1 |
| Socratic KVL/KCL tutor grounded in solver numbers (Groq) | 3 | 2 | 4 | 4 | 3 |
| Voice-guided measurement (browser speech API) | 4 | 2 | 3 | 2 (UI-owned files) | 1 |

Why Probe Guide: ROADMAP already names "next-best-measurement debugging" as the differentiator. Probe Guide is
pure backend: new files only, no model calls, no new deps. It reuses `solveDC` as the only math authority,
and on the demo ladder it finds the fault in 2–3 readings. The breadboard-photo idea uses the most models but can't be done reliably before freeze.
Multimodel note: Probe Guide adds no model calls. It strengthens the *post-extraction* half of the pipeline that Gemini/Groq/Jev feed.

## Design (`src/lib/probe/index.ts`)
1. **Hypotheses**: `nominal` (prior 0.5) plus single faults sharing the other 0.5. For each resistor: open (1 GΩ), short (1 mΩ), ×10 and ÷10
   (a multiplier band misread). For each source: dead (0 V). Each one is re-solved with `solveDC`, and any the solver rejects are dropped.
2. **Posterior**: Gaussian likelihood of each observed node voltage with σ = 2 % of the reading + 10 mV (meter + model tolerance), normalized with log-sum-exp.
3. **Next probe**: for each unmeasured non-GND node, group hypotheses whose predicted voltages are within 2σ (a meter can't tell
   them apart). Expected bits = H(posterior) − Σ P(group)·H(posterior | group). Pick the node with the highest value.
4. **Stop** when the top hypothesis is ≥ 90 %, or when no probe gives ≥ 0.05 bits. In the second case it says honestly that the
   remaining faults look identical at every node and need an ohmmeter check with the power off.
5. **fitWarning** when even the best hypothesis is > 3σ from a reading: "no single-fault hypothesis explains…". Possible causes are a
   multi-fault, a wrong diagram, or the wrong meter range. It never makes up a fit.

## API: `POST /api/probe`
Request: `{ graph: CircuitGraph, userConfirmed: true, observations?: { node: string, volts: number }[] }`
Response `200`: `{ result: { hypotheses: [{ id, title, probability, predicted: Record<node,V> }], next: { node, expectedBits,
instruction, outcomes: [{ volts, hypothesisIds, probability }] } | null, done, reason, fitWarning?, safety, trace } }`
Errors match `/api/solve`: `BAD_JSON` 400, `INVALID_REQUEST` / `NOT_CONFIRMED` / `INVALID_GRAPH` 422.

## Demo steps (≈60 s, sample ladder: 5 V → R1 → A → R2 → B → R3 → GND, all 10 kΩ, measure B)
1. Confirm the graph. Enter B = **0 V**. The guide says: "Measure **A** next (~1.5 bits)". The outcome preview shows 0 V → R1 open / V1 dead,
   2.5 V → R3 short, 5 V → R2 open.
2. Enter A = **5 V**. Done: **R2 open / not connected**, > 90 %.
3. Optional honesty beat: on the 10k/10k divider, VOUT = 0 and VIN = 5 can't separate "R1 open" from "R2 shorted". The guide stops
   and asks for a power-off ohmmeter check instead of guessing.

```bash
curl -s localhost:3000/api/probe -H 'content-type: application/json' -d '{"userConfirmed":true,"observations":[{"node":"B","volts":0}],
 "graph":{"schemaVersion":1,"groundNode":"GND","measureNode":"B","components":[
 {"id":"V1","kind":"dc_voltage","value":5,"positiveNode":"VIN","negativeNode":"GND"},
 {"id":"R1","kind":"resistor","value":10000,"positiveNode":"VIN","negativeNode":"A"},
 {"id":"R2","kind":"resistor","value":10000,"positiveNode":"A","negativeNode":"B"},
 {"id":"R3","kind":"resistor","value":10000,"positiveNode":"B","negativeNode":"GND"}]}}'
```

## Limits
- Single-fault model only, and only the listed fault types (open, short, ×10, ÷10, dead source). Nothing outside them is
  hypothesized. Multi-faults show up as `fitWarning`, not as an answer.
- Probes are node-to-GND voltages only (no current or in-circuit resistance probes).
- The 0.5 nominal prior, σ and the thresholds are hand-picked, not calibrated on lab data.
- Probabilities are model-relative confidence, not validated fault rates.

## UI handoff spec (implemented; kept for reference)
- After a solve with a mismatching `measuredVoltage`, show a **"Guide me"** button. It calls `/api/probe` with
  `observations: [{ node: graph.measureNode, volts: measuredVoltage }]`.
- **Probe card**: big text "Measure **{next.node}**", then `next.instruction`, then a number input (V) and a Submit button. Submit adds
  `{node, volts}` to the observations and calls the API again (stateless: the client keeps the observation list).
- **Outcome preview** (the wow moment): list `next.outcomes` as "≈ {volts} V → {titles of hypothesisIds}" so students see *why* this node.
  Highlight `next.node` on the schematic if node positions exist.
- **Hypothesis bars**: top 5 `hypotheses` with probability bars. They update after each reading.
- When `done`, show the `reason` as the conclusion card. Show `fitWarning` as an amber banner. Always show `safety` in small text.
- Show the reading history as chips ("B = 0 V", "A = 5 V") with remove (×) to undo.
