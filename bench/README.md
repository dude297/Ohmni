# bench: diagnosis-honesty benchmarks

Deterministic (fixed seeds), no network, no models. Run: `BENCH=1 BENCH_LABEL=after npx vitest run bench/run.test.ts`
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
