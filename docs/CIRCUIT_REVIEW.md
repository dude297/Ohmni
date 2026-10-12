# Circuit Review

Deterministic electrical review plus a grounded AI mentor. Code: `src/lib/review/{rules,review,mentor,index}.ts`, route `src/app/api/review/route.ts`, tests `tests/review/`.

## Review (no model)
`reviewCircuit(graph, { ratings?, intended? }) -> { findings, solution? }`. Every finding has `severity`, `category`, `components`, `nodes`, `basis` (`rule` | `simulation` | `design_diff`) and `evidence.numbers`, which come only from the validator/solver.

Rules: validateGraph failures mapped to findings; supply short (source terminals joined by a series resistor path of at most 1 mohm, or both terminals on one node); parallel sources (different voltage = error, equal = warning); ground naming ambiguity; single-terminal nodes; per-resistor P = I^2 R vs a supplied rating (no rating = one info finding); value and connectivity mismatch vs `intended` (matched by refdes, node names literal).

Scope: resistors and DC sources only. LED/semiconductor checks are never claimed; unsupported kinds are rejected by validation and reported as such.
Known ceiling: shorts are series-path only (parallel-combination shorts are not detected).

## Mentor (Gemini, `EXPLAIN_MODEL` / gemini-3.5-flash-lite)
`mentorExplain({ graph, finding, level, mode, hintIndex? })`. The model sees only the one finding plus solver facts rounded to 4 s.f., and can never add findings. All numbers in the reply go through `checkGrounding` (reused from `src/lib/explain`); `grounded` / `ungroundedNumbers` report the result. `hint` mode sends no numbers to the model and any reply containing a number is replaced by a canned hint. No key, timeout or malformed output gives "Mentor unavailable — deterministic summary" with a skipped/error trace.

## API
`POST /api/review { graph, userConfirmed: true, intended?, ratings?, mentor?: { findingId, level, mode, hintIndex? } }` returns `{ result: { findings, solution?, mentor?, trace } }`. Errors: `{ error: { code, message, details? } }` (BAD_JSON 400; INVALID_REQUEST, NOT_CONFIRMED, FINDING_NOT_FOUND 422).

## Integration TODO
`src/proxy.ts` is not part of this change: add `/api/review` to its rate-limit matcher when integrating (it can call Gemini).
Live check: `RUN_LIVE_MENTOR=1 LIVE_KEY=<gemini key> npx vitest run tests/review` (one Gemini call).
