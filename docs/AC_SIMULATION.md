# AC simulation (moonshot, branch `moonshot/ac-spice`)

Sandboxed frequency-response adapter. **Not wired into the DC flow**: `solveDC`, `/api/solve` and the v1 `CircuitGraph` are untouched.
Merged into main through [#69](https://github.com/dude297/Ohmni/pull/69). This is experimental source; its unit/build results are not a hosted-user-flow claim. See [current verification](CURRENT_STATE.md).
Research background: `git show f39f3b8:docs/research/SPICE_AC_TRANSIENT.md`.

## Pieces
| File | Role |
|---|---|
| `src/lib/ac/types.ts` | `AcGraph` (schemaVersion 2), `LIMITS`, `validateAcGraph` (<= 12 parts, R 1 Ω-10 MΩ, C 1 pF-10 mF, L 1 nH-10 H, exactly one `ac_source`, amplitude 1) |
| `src/lib/ac/netlist.ts` | Typed graph -> SPICE text. Element names regenerated (`R1`, `C2`, `L3`, `V1` from array index), nodes mapped `GND->0`, others `n1..nk`, values as `1.000000000e3`, `.ac dec <=50 1..1e7`. No user string ever reaches the text; no `.include/.lib/.control`, no file IO |
| `src/lib/ac/engine.ts` | ngspice (`eecircuit-engine@1.8.0`, MIT, ngspice-45.2) in a **worker thread**; 10 s timeout that terminates the worker; one sim at a time, queue <= 3 (else `BUSY`/429) |
| `src/lib/ac/analysis.ts` | nominal curve, fault candidates (each R/C/L x0.1 and x10, ranked by RMS dB vs measured points), discriminator |
| `src/app/api/ac/route.ts` | `POST /api/ac` (no `runtime` export) |
| `src/app/ac/**` | `/ac` page: SVG Bode (magnitude + phase, log f, cursor), presets, log sliders (re-simulate on release, 150 ms debounce), MEASURED overlay, fault finder |

## API
`POST /api/ac { graph, userConfirmed: true, faults?, measuredPoints?: [{freqHz, magDb}] }` -> `{ result: { nominal, candidates?, discriminator?, trace } }`.
`faults: true` requires `measuredPoints`. Errors: `{ error: { code, message, details? } }` with `BAD_JSON` 400, `INVALID_REQUEST`/`NOT_CONFIRMED`/`INVALID_GRAPH`/`UNSOLVABLE` 422, `BUSY` 429, `TIMEOUT` 504.
Fixed sweep: 20 points/decade, 1 Hz-10 MHz.

## Why a worker thread (found the hard way)
`eecircuit-engine`'s `start()` sets `globalThis.window = {}`. In the Next server process that makes framework code take browser paths
(`Cannot destructure property 'protocol' of 'window.location'`) and **every route 500s after the first simulation**, including `/api/solve`.
Deleting `window` afterwards breaks the engine itself. The worker keeps those globals isolated (regression test: `tests/ac/engine.test.ts`).

## Fault discrimination
For an RC low-pass (1 kΩ / 1 µF) with a measured -3 dB point near 1.59 kHz, `C1 x0.1` and `R1 x0.1` move fc identically, so output magnitude cannot separate them
(both fit at ~0.05 dB RMS). The discriminator is computed from the same solver runs:
- Power-off DC resistance across R1: **1 kΩ** if the fault is C1, **100 Ω** if it is R1.
- Alternative, |Zin| at the grid point nearest the measured corner (~1.78 kHz): ~**1.34 kΩ** if C1, ~**134 Ω** if R1.

Caveat: the DC-resistance prediction assumes no parallel DC path around the resistor. The UI labels simulated curves SIMULATED and user points MEASURED.

## Validation (tests/ac, real engine, 50 pts/decade)
| Case | Analytic | ngspice |
|---|---|---|
| RC 1k/1µF, every grid point | `1/(1+jωRC)` | < 0.02 dB, < 0.1° |
| RC at fc = 159.155 Hz | -3.01 dB, -45° | -3.01 dB, -45° (interpolated) |
| RLC R100 L10mH C1µF | f0 = 1591.5 Hz, 0 dB, Q = 1 | peak within 1 grid point, \|dB\| < 0.05, Q 0.93-1.07 |
| CR high-pass 1k/1µF at fc | -3.01 dB, +45° | -3.01 dB, +45° |

## Limits / not done
Per-instance in-memory queue; engine path resolved from `process.cwd()`. The integration adds `outputFileTracingIncludes` for the engine files, but serverless deployment behavior still needs hosted verification. `/api/ac` is covered by the central POST limiter (20/min by default, `RATE_AC_PER_MIN`) as well as the queue cap and worker timeout. No application-authentication layer or transient analysis is claimed.
