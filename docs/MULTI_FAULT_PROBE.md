# Two-fault Probe Guide (moonshot, post-submission)

`probeStepMulti(graph, observations, { maxFaults: 1 | 2, pairPrior? })` in `src/lib/probe-multi/`. Same return shape as `probeStep` (plus `pairCandidates`, `pairsSolved`, `notes`, `warnings`), so a UI can swap it in. `src/lib/probe` is untouched.

## Method

- Hypotheses: nominal + every single fault (open / short / x10 / x0.1 per resistor, source dead) + every unordered PAIR of single faults on DIFFERENT components. Each pair is solved by `solveDC` with both patches applied.
- Scoring and probe choice are identical to `probeStep`: Gaussian likelihood with sigma = 2 % of reading + 10 mV, expected-information-gain node choice, DONE_P 0.9, MIN_BITS 0.05.
- `maxFaults: 1` delegates straight to `probeStep` (byte-identical result).

## Priors

Nominal 0.5; each single = 0.5 / (number of single faults), as in `probeStep`. Each pair = `pairPrior` (default **0.1**) x one single-fault prior. This is a judgment call (two independent faults are rarer), not a calibrated rate. Because pairs add hypotheses, a lone single-fault conclusion can be a little less confident than with `probeStep` (R6 open on the bridge: still top, but needs one more reading to cross 0.9).

## Equivalence merging

If a pair predicts the same voltage at every node (within 0.5 meter sigma, `EQ_SIGMAS`, so no voltage measurement could tell them apart) as an already-kept hypothesis (nominal, a single, or an earlier pair), it is dropped and a line is added to `notes` ("X + Y merged into Z"). Its prior mass is NOT added to the survivor (it would inflate e.g. "supply dead", which absorbs every pair containing the dead supply). Bridge: 364 pair candidates, 281 kept, 83 merged.

## Cap

More than 2,000 pair candidates (counted before solving): fall back to singles, push a `warnings` entry, report `pairCandidates`. The bridge (8 parts) has 364; about 18 resistors exceed the cap.

## fitWarning

If no single hypothesis (nor nominal) fits every reading within 3 sigma but a pair does, `fitWarning` says "No single-fault hypothesis explains the readings. The best explanation is two independent faults: ... still a hypothesis; confirm each part with power off and an ohmmeter." If nothing fits, it says neither single nor two-fault hypotheses explain the reading.

## Performance (vitest, this machine)

Bridge, maxFaults 2: ~36 ms for 364 pairs. Limit asserted: < 1.5 s.

## Limits

Model-relative and uncalibrated. DC resistive circuits only; faults are the five canned kinds. Two faults on the same component are not modelled. Pairs with many near-degenerate readings can still be ambiguous with few probes. Not a confirmed diagnosis.

## When to enable

Only when the single-fault run shows a `fitWarning` (or the user says it still looks wrong after probing). Default stays single-fault: pairs dilute the posterior and add noise when one fault explains the data.

## UI sketch (ChatGPT Work)

Keep calling `probeStep`. When `step.fitWarning` is set, show an inline action "Consider two faults" under the warning. Clicking re-runs with `probeStepMulti(graph, obs, { maxFaults: 2 })` and replaces the ranked list; pair rows are labelled "Two independent faults" with the merge `notes` in a collapsed "why some pairs are hidden" section, and any `warnings` (cap fallback) shown above. A toggle off returns to the single-fault view; existing readings carry over.
