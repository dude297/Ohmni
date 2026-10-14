# bench: diagnosis-honesty benchmarks

Deterministic (fixed seeds), no network, no models. Run: `BENCH=1 BENCH_LABEL=after npx vitest run bench/run.test.ts` (`BENCH_SEED=777` = held-out split, `BENCH_OHM=1` = the simulated user also takes the ohmmeter readings the guide asks for)
(writes `bench/report/<label>.json`, git-ignored). Without `BENCH=1` the run is skipped. `baseline-main-d6bc997.json` is the
same report taken on origin/main d6bc997 before this change.

## Probe calibration (`calibration.ts`, seed 20261012, 300 sessions per set, 200 for nominal sets)
A simulated user follows the guide's next-probe advice on fixtures divider / series-parallel / loaded bridge; readings = truth + N(0, sigma),
sigma = 2 % of reading + 10 mV. Groups:
- `in-model`: one modeled fault (open/short/x10/x0.1/dead). `in-model+tol`: same with every resistor drawn within +-5 %. `nominal+tol`: no fault, +-5 % parts.
- `out-of-model`: a resistor x3, x0.3, x2, x1.5, or two simultaneous faults (x10 + short): nothing in the hypothesis set is correct.

Metrics: `top1` (best id == truth id), `top1EquivAware` (or best predicts every node within 2 sigma of the truth hypothesis; the honest in-model
accuracy because x0.1 vs short etc. are electrically identical), `meanProbes`, `confidentWrong` (best hypothesis >= 0.9, not 'unmodeled', wrong),
`silentConfidentWrong` (same, but no `fitWarning` and `fit != 'poor'`), `detectableConfidentWrong` (wrong and the chosen hypothesis contradicts the true
voltage by > 3 meter sigma at some node; the rest are faults no voltage probe can see), `flagged` (ended with `fit: 'poor'` or 'unmodeled' on top).

## Grounding corpus (`grounding-corpus.ts`)
50 labelled sentences (28 must-accept, 22 must-reject) checked with the real `allowedNumbers` + `checkGrounding` on the 10k/10k divider.
`falseAcceptRate` = rejects that passed; `falseRejectRate` = accepts that were flagged.

## Solver stress (`solver-stress.ts`, seed 4242, 2000 random 6-node networks, 1 mOhm - 1 TOhm)
Independent worst-node KCL imbalance of the returned currents / largest current. `silentOver1e6` = violations above 1e-6 with no
`warnings: ['ill_conditioned']`. Also the audit's R1 = 1e-12 ohm case.

## Out-of-model results (2026-10-14, every-node confirmation)
Change: a conclusion now waits for every resistor-dependent node (cap 6), not 2 readings. Held-out = `BENCH_SEED=777`, never used for tuning.

| | tuning before | tuning after | held-out before | held-out after |
|---|---|---|---|---|
| out-of-model confident-wrong | 7.36 % | 6.57 % | 7.12 % | **6.19 %** |
| of which detectable (some node > 3 meter sigma off) | 1.86 % | 1.10 % | 2.76 % | 1.57 % |
| of which undetectable by any voltage probe | 5.50 % | 5.47 % | 4.36 % | 4.62 % |
| in-model top-1 (equivalence-aware) | 98.44 % | 98.44 % | 98.78 % | 98.78 % |
| in-model + 5 % parts (equivalence-aware) | 97.89 % | 97.78 % | 97.56 % | 98.00 % |
| mean probes, in-model | 1.53 | 1.73 | 1.54 | 1.74 |

The < 5 % target is **not met**, and cannot be with voltage probes alone on this bench. The undetectable part is a floor: in those sessions the
true circuit gives the same voltages (within meter noise) as a modeled hypothesis at every node, e.g. `R3 x10 + R4 short` is exactly `R4 short`,
and a x1.5 drift sits inside meter + part tolerance of "nominal". Any rule that withholds confidence there withholds it from the identical
in-model case too: raising `UNMODELED_PRIOR` to 0.25 / 0.4 gives 5.26 % / 4.69 % out-of-model but drops in-model top-1 to 97.78 % / 95.89 % (below
the 98 % bar), so the prior stays 0.15. Lowering the floor needs a different measurement (ohmmeter, current) or reporting electrically
equivalent alternatives instead of one label. Grounding false-accept 0 and silent KCL violations 0 are unchanged.

## Ohmmeter mode results (2026-10-14, opt-in power-off resistance readings, docs/PROBE_GUIDE.md)
Same sessions with `BENCH_OHM=1`: when the guide asks, the simulated user reads the true power-off resistance between two nodes with 1 % + 0.5 Ω
noise. New metrics: `meanOhm` (resistance readings per session, included in `meanProbes`) and `inCircuitDetectableRate` (confident-wrong where
the chosen hypothesis differs from the truth at some node voltage OR some power-off pair resistance by > 3 meter sigma). Constants were set on
the tuning seed only; held-out = `BENCH_SEED=777`.

| | tuning, voltage only | tuning, ohmmeter | held-out, voltage only | held-out, ohmmeter |
|---|---|---|---|---|
| out-of-model confident-wrong | 6.57 % | 3.83 % | 6.19 % | **3.93 %** |
| of which in-circuit detectable | 6.57 % | 1.67 % | 6.19 % | 1.81 % |
| of which identical in-circuit (floor) | 0 % | 2.16 % | 0 % | 2.12 % |
| in-model top-1 (equivalence-aware) | 98.44 % | 99.78 % | 98.78 % | 100 % |
| in-model + 5 % parts (equivalence-aware) | 97.78 % | 99.67 % | 98.00 % | 99.67 % |
| mean readings, in-model (of which resistance) | 1.73 | 4.29 (2.70) | 1.74 | 4.38 (2.79) |
| mean readings, nominal + 5 % parts | 1.67 | 4.95 (3.28) | 1.66 | 4.95 (3.28) |

Voltage-only numbers are unchanged from the every-node-confirmation table above (the mode is opt-in). With voltages only, every out-of-model
miss would have been visible to some in-circuit reading; the ohmmeter removes about three quarters of those. Most of the remaining 3.9 % is a
new floor: faults identical at every node and every pair in-circuit, almost all `R2 x3` in the series-parallel fixture (600 Ω parallel to
R3 300 Ω equals R2 200 Ω with R3 open). Only lifting a lead, or reporting electrically equivalent alternatives, separates them. Cost: about 2.6
more readings per session, each needing the power off. Tuning steps on the tuning seed: coverage threshold 3 → 5 sigma (5.74 % → 5.14 %), two
covering readings per resistor (→ 3.83 %), faulted part tested halfway back to its design value (fixes `R5 x3` read as `R5 x10`).
