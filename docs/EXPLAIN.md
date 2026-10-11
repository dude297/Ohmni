# Explain my circuit (`POST /api/explain`)

Solver-grounded EE tutor. The local MNA solver is the only math authority. An LLM (Gemini, `EXPLAIN_MODEL`,
default `gemini-3.5-flash-lite`, free tier) only writes the prose, and code checks every number in it.

## Contract
Request: `{ graph: CircuitGraph, userConfirmed: true, measuredVoltage?: number }`

200: `{ result: { explanation: { summary, steps: {title,text}[] } | null, grounded, ungroundedNumbers, facts: { voltages, currents, hypotheses?: {title}[] }, trace } }`

Errors (same as `/api/solve`): 400 `BAD_JSON`; 422 `INVALID_REQUEST`, `NOT_CONFIRMED`, `INVALID_GRAPH`, `UNSOLVABLE`; 429 `RATE_LIMITED` (10/min/IP, `RATE_EXPLAIN_PER_MIN`).

No key, model error, timeout (15 s) or malformed JSON → `explanation: null`, `grounded: false`, and a trace event `skipped` or `error` with a note. No canned text is ever returned.

## Grounding
1. Allowed numbers: node voltages, |currents| (A and mA), component values (Ω, kΩ, MΩ, V), resistor voltage drops, source load resistance (V/|I|), the measured voltage and the expected−measured gap, every number in the diagnosis hypotheses, and integers 0–10 (step numbering). All are computed in code from solver/diagnosis output.
2. Numbers in the summary and step titles/texts are extracted with an optional prefix/unit (`V mV A mA µA Ω kΩ MΩ k ohms`) and normalized to SI.
3. A number matches if it is within 1 % relative, or 1e-6 in its written unit's scale. Anything else goes into `ungroundedNumbers` and sets `grounded: false`. The text is still returned so the UI can warn.

## Limits
Percentages or ratios the model computes itself (e.g. "50 %") are flagged as ungrounded by design. The rate limit is in-memory per instance.
