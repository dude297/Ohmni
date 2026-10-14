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
Benchmarks: `bench/README.md`.
