# Probe Guide honesty rules (`POST /api/probe`, `/api/probe-multi`)

The hypothesis set is nominal + single faults (+ pairs in probe-multi). Real boards also have faults outside that set (drifted part, wrong value,
two faults), so the guide scores a fixed extra hypothesis and gates its conclusion on goodness of fit.

- **`unmodeled`** ("No single modeled fault fits these readings"): prior 0.15, likelihood a broad Gaussian mixture centred on every modeled prediction
  (width 10 % of the supply span). Its `predicted` is `{}`. Consumers that read `predicted[node]` must skip it.
- **Part tolerance**: for each hypothesis, sigma_total^2 = sigma_meter^2 + sigma_parts^2, sigma_parts from finite-difference sensitivity of every node to each
  resistor moving +5 % (independent uniform errors). Meter sigma stays 2 % + 10 mV.
- **`fit: 'good' | 'poor'`**: poor when the best modeled hypothesis misses a reading by more than 3 sigma_total, or `unmodeled` out-ranks it.
  `outOfModelProbability` is the posterior of `unmodeled`. Both are additive response fields.
- **`done`** needs `fit: 'good'`, posterior >= 0.9, and every resistor-dependent node measured (fault conclusions cap at `MAX_CONFIRM` = 6
  readings, taken where the leader differs most from the other hypotheses). Any verdict, "nominal" or "R6 open", is a claim about every node, and a
  second unmodeled fault often shows only at a node not yet probed. When fit is poor, `done` is false: the guide proposes the most informative unmeasured node, and when
  none is left says to power off and use an ohmmeter.
- probe-multi uses the same scorer; its pair-equivalence merge tolerance is 0.5 meter sigma per node (was 1e-9 V).

Known limit: faults smaller than meter + tolerance noise (e.g. a bridge arm x1.5) are indistinguishable from nominal with voltage probes; a nominal verdict says so.

## Ohmmeter mode (opt-in: `probeStep(graph, readings, { ohmmeter: true })`, `/api/probe` `ohmmeter: true`)
Voltage-only out-of-model misses are a floor (bench: ~4.6 % held-out): e.g. `R3 x10 + R4 short` gives exactly the voltages of `R4 short`. Power-off
resistance readings between two nodes see such cases.
- **Reading**: `{ kind: 'resistance', a, b, ohms }` (send `1e9` for OL). Voltage readings keep `{ node, volts }`; old clients are unaffected.
- **Model**: power disconnected means the supply is **removed (open)**, as the safety text instructs (a shorted ideal source would hide the
  arm it parallels, e.g. R3 in the bridge). Each hypothesis predicts R(a, b) with the existing MNA solver (1 V test source across a, b).
- **Likelihood** in ln(Ω): meter 1 % + 0.5 Ω (3½-digit DMM) plus each hypothesis's part tolerance (5 % per resistor, as for voltages);
  readings floored at 1 Ω (lead resistance) and capped at 1e8 Ω (OL). `unmodeled` gets a mixture of width 1 in ln(Ω).
- **When it asks**: never before the first voltage reading. (1) While discriminating, only if a resistance reading splits the modeled faults
  better (expected bits) than every remaining voltage probe. (2) Before concluding: until every resistor has been seen by 2 different readings
  that a x1.5 drift of it would move by > 5 sigma (for the part the hypothesis itself changed, e.g. R5 x10, halfway back to the design value),
  at most `MAX_OHM` = 4 readings. Two readings, because deviations in two parts can cancel at one pair.
- **`next`** gains `kind: 'resistance'`, `a`, `b`, `ohmOutcomes: { ohms, hypothesisIds, probability }[]`; `node` repeats `a` and `outcomes` is `[]`.
- **Remaining floor**: some faults are identical in-circuit at every node pair too (e.g. R2 x3 parallel to R3 = R3 open in the series-parallel
  fixture); only lifting a lead separates them. The bench reports this separately (`inCircuitDetectableRate`).
Benchmarks: `bench/README.md`.
