# Explain my circuit (`POST /api/explain`)

Solver-grounded EE tutor. The local MNA solver is the only math authority. An LLM (Gemini, `EXPLAIN_MODEL`,
default `gemini-3.5-flash-lite`, free tier) only writes the prose, and code checks every number in it.

## Contract
Request: `{ graph: CircuitGraph, userConfirmed: true, measuredVoltage?: number }`

200: `{ result: { explanation: { summary, steps: {title,text}[] } | null, grounded, ungroundedNumbers, facts: { voltages, currents, hypotheses?: {title}[] }, trace } }`

Errors (same as `/api/solve`): 400 `BAD_JSON`; 422 `INVALID_REQUEST`, `NOT_CONFIRMED`, `INVALID_GRAPH`, `UNSOLVABLE`; 429 `RATE_LIMITED` (10/min/IP, `RATE_EXPLAIN_PER_MIN`).

No key, model error, timeout (15 s) or malformed JSON → `explanation: null`, `grounded: false`, and a trace event `skipped` or `error` with a note. No canned text is ever returned.

## Grounding
Every digit run in the prose becomes a typed claim `{value, dimension}` (V, A, Ω, W, %, or none). A claim is grounded only if a fact of the **same dimension** matches.
1. Facts (typed, computed in code): node voltages and resistor drops (V), |currents| (A), resistor values (Ω), source values (V), source load resistance V/|I| (Ω), per-component power (W), the measured voltage and the expected-measured gap (V), and every number in the diagnosis hypotheses (typed by its own unit).
2. Extraction covers glued units (`99volts`, `5V`), scientific notation (`1e5 ohms`, `2.5e-3 A`, `2.5 x 10^-3`), thousands separators (`10,000`, `1 000 000`, thin/no-break spaces), prefixes `k M m u µ` and words (`kilohms`, `milliamps`), and `%`. Labels such as R12 / V1 are skipped.
3. Match: 1 % relative, or honest rounding to the written decimals (capped at 5 % relative), or 1e-6 in the written unit's scale.
4. Unitless numbers are never voltages: they pass only as step ordinals (`Step 2`, or a `1.` list marker) up to the step count (5), or as precision (`3 significant figures`).
5. `checkGrounding(text, facts)` also accepts plain numbers; those are dimension-agnostic (used by the mentor for evidence numbers of unknown unit).
Anything else goes into `ungroundedNumbers` and sets `grounded: false`. The text is still returned so the UI can warn. Corpus and false-accept/reject rates: `bench/README.md`.

## Limits
Percentages or ratios the model computes itself (e.g. "50 %") are flagged as ungrounded by design. The rate limit is in-memory per instance.
