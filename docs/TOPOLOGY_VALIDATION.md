# Topology engine validation (Moonshot B)

Validates the dual-candidate topology engine from #57 (`src/lib/topology/candidates.ts`, `POST /api/topology`).
No production code was changed. Everything is repeatable offline: `npx vitest run tests/topology` (add `BENCH_REPORT=1` to print the full row-per-check table).

- Fixture: `fixtures/topology/benchmark.json` (13 labelled ambiguous-pair cases, 8 resistance networks). Every case has `id`, `description`, `graph`, `ambiguous` pair and hand-derived `expected` values with a `derivation` string.
- Test: `tests/topology/benchmark.test.ts`. Expectations come from the fixture (hand algebra) or from oracles written in the test (the meter-model separation formula, and a Laplacian pseudo-inverse effective-resistance solver, `L+ = (L + J/n)^-1 - J/n`, a different algorithm from the engine's nodal solve). The engine is never called to produce an expected value.
- Result: all pass, no engine bug found. 100 benchmark tests (114 with the existing suite).

Meter model used by the engine and mirrored by the oracle: resistance sigma = 2 % + 1 ohm, voltage sigma = 2 % + 10 mV, `separation = |a-b| / (sigma_a + sigma_b)`, decisive when `>= 3` (so a lone resistance step from x to 0 is decisive above x = 6.383 ohm).
Readings are given as "supply shorted / supply unplugged". B = the two ambiguous nodes joined.

## Ambiguous-pair cases

| case | expected A (short/unplug) vs B | engine | decisive / poweredSafe | alias (survivor) | pass |
|---|---|---|---|---|---|
| div-vout-gnd (5 V, 10k/10k, VOUT-GND) | 5k / 10k vs 0 / 0 | same | true / true | VOUT->GND (GND) | pass |
| div-12v-1k-3k3 (VOUT-GND) | 767.44 / 3300 vs 0 | same | true / true | VOUT->GND | pass |
| div-gnd-first (pair given as GND,VOUT) | 5k / 10k vs 0 | same | true / true | VOUT->GND, GND survives either order | pass |
| div-vin-vout (R1 shorted if joined) | 5k / 10k vs 0 | same | true / true | VOUT->VIN | pass |
| ladder-n2-gnd (2-section ladder) | 10000/11 = 909.09 / 1200 vs 0 | same | true / true | N2->GND | pass |
| sp-mid-gnd (100 / 200,300) | 600/11 = 54.55 / 120 vs 0 | same | true / true | MID->GND | pass |
| sp-vin-mid | 54.55 / 100 vs 0 | same | true / true | MID->VIN | pass |
| bridge-balanced-l-r (four 1k, equipotential L,R) | 1000 / 1000 vs 0; best voltage separation 0 | same (0) | true / true | R->L | pass |
| supply-short-vin-gnd | 0 / 20k vs 0 / 0 (needs unplug) | same | true / **false** | VIN->GND | pass |
| overcurrent-a-gnd (5 A through 1 ohm, not a source short) | 0.9999 / 10k vs 0 | same | true / **false** | A->GND | pass |
| shunt-1ohm-indistinguishable | 0.99995 / 1 vs 0; sep 0.495 | same | **false** / true | Y->X | pass |
| shunt-6ohm-below-threshold | 5.998 / 6 vs 0; sep 2.830 | same | **false** / true | Y->X | pass |
| shunt-7ohm-above-threshold | 6.998 / 7 vs 0; sep 3.270 | same | true / true | Y->X | pass |

## Resistance oracle (hand == Laplacian == engine, all agree to 1e-9 relative)

| network (T-B unless stated) | hand value | engine | pass |
|---|---|---|---|
| series 1k+2k+3k | 6000 | 6000 | pass |
| parallel 1k,2k,3k | 6000/11 = 545.45 | 545.45 | pass |
| triangle (1k+2k)\|\|3k | 1500 | 1500 | pass |
| Wheatstone balanced, all 1k (+1k bridge) | 1000 | 1000 | pass |
| Wheatstone balanced by ratio 1:2, bridge 7k irrelevant | 2000 | 2000 | pass |
| Wheatstone UNBALANCED 1,2,3,4 + 5k bridge | 170000/71 = 2394.37 | 2394.37 | pass |
| 3-section ladder N0-GND (1k series / 2k shunt) | 43000/21 = 2047.62 | 2047.62 | pass |
| disconnected islands | open | Infinity | pass |
| 40 seeded random connected networks | Laplacian | agree (1e-8) | pass |

## Safety and input checks

| check | expected | engine | pass |
|---|---|---|---|
| Candidate B shorts V1 (VIN+GND) | poweredSafe false, no voltage option, no "power ON", "DO NOT power", unplug wording | as expected, also via POST | pass |
| Candidate B overloads supply (5 A) | same | same | pass |
| Conflicting ideal sources merged (5 V vs 3 V) | poweredSafe false | false (SolveError caught) | pass |
| Exhaustive sweep: every node pair of 16 graphs (66 pairs, 19 unsafe) | unsafe => resistance only + DO NOT power; `decisive == (separation>=3)`; safe => no DO NOT | all compliant | pass |
| Unknown node (a or b), wrong case, same node twice (also after trim), blank, ambiguous missing/array, body null | 422 INVALID_REQUEST | same | pass |
| Missing GND, floating subcircuit, unsupported component kind | 422 INVALID_GRAPH | same | pass |
| userConfirmed false / "true" / 1 | 422 NOT_CONFIRMED | same | pass |
| `graph` or `userConfirmed` key absent | 422 (INVALID_REQUEST) | 422 INVALID_REQUEST | pass |
| Invalid JSON | 400 BAD_JSON | same | pass |
| Whitespace around node names | trimmed, 200 | 200 | pass |

## Findings (observations, not bugs; no `it.fails`/skip was needed)

1. "Observationally indistinguishable" is narrower than it sounds. Merging two equipotential nodes with no resistor between them (the balanced bridge, L-R) leaves every node voltage unchanged (voltage separation 0), but a power-off ohmmeter across the pair still reads 1 k vs 0, so the engine is right to call it decisive. The engine only declines to call decisive when the nodes are already joined by roughly < 6.4 ohm (shunt cases), because then even the ohmmeter cannot resolve it. A true "cannot tell" case for resistance does not exist for distinct nodes.
2. For a non-decisive result the engine may still set `unplugSupply: true` (when the unplugged reading is marginally larger than the default one, e.g. 0.495 vs 0.4950+). Harmless, but UIs should not read `unplugSupply` as meaningful when `decisive` is false.
3. Missing `graph`/`userConfirmed` keys fail the zod gate as `INVALID_REQUEST`, not `INVALID_GRAPH`/`NOT_CONFIRMED`; only explicit wrong values reach the specific codes.
4. If a future change makes the engine claim `decisive` for a shunt below ~6.4 ohm, the `shunt-*` cases and the monotonic-threshold test fail.

## Safety limitations

- The safe-to-power test is a model: ideal sources, resistors only, a fixed 0.5 A limit (`MAX_SAFE_A`) and no component power ratings. A wiring that is "safe" here can still overheat a 0.25 W resistor (e.g. 12 V across 100 ohm = 1.4 W at 120 mA).
- It only evaluates the two candidates it was given. A third, unmodelled wiring (a different mis-read junction) is invisible to it.
- Only join (merge) is modelled; splitting a net is not supported.
- "Power off" resistance assumes the user unplugs the supply when asked, and that nothing else (capacitors, diodes, LEDs, ICs) conducts. Parallel parasitic paths on a real breadboard lower the reading; the engine's meter model (2 % + 1 ohm) does not cover parallel parasitics or a 1e9 ohm open that reads lower in practice.
- `decisive` is statistical against a nominal meter model, not a guarantee. Resistor tolerance is not modelled beyond the 2 % meter term.
- The result is guidance for a human who confirmed the circuit (`userConfirmed`). Nothing here should drive an actuator or power relay.

## What this demonstrates, and what it does not

Demonstrates: for a human-confirmed resistor/DC-source graph with exactly one ambiguous junction, the engine deterministically (no model calls) builds the as-read and merged wirings, picks the single meter reading that separates them best, quantifies the separation, refuses to recommend powering when a candidate shorts or overloads the supply, and its resistances match closed-form and Laplacian references on bridges and ladders.

Does not: understand general schematics or images (the graph is an input); handle more than one ambiguous junction at once, splits, non-resistive parts, AC, or real tolerances; or prove a fault. A reading that matches candidate A or B supports that wiring; a reading matching neither means both candidates are wrong and no fault is identified. No fault certainty.

## Interfaces for a future interactive topology explorer

`POST /api/topology`, as implemented in `src/app/api/topology/route.ts` (request gate and error shapes match `/api/probe`; no model calls).

```ts
import type { CircuitGraph } from '@/lib/circuit/types';

export type TopologyRequest = {
  graph: CircuitGraph;            // validated server-side with validateGraph
  userConfirmed: true;            // anything other than boolean true => 422 NOT_CONFIRMED
  ambiguous: { a: string; b: string }; // two different node names of graph; trimmed, case-sensitive
};

export type TopologyCandidate = {
  id: 'A' | 'B';
  title: string;                    // A: "As read: a and b not connected"; B: "a and b connected"
  graph: CircuitGraph;              // B has the resistors shorted by the merge removed
  alias: Record<string, string>;    // {} for A; B: { [mergedAwayNode]: survivingNode } (GND always survives)
  shortsSupply: boolean;            // B collapses a voltage source onto one node
};

export type Prediction = { candidateId: string; value: number; openSupplyValue?: number }; // ohm: capped at 1e9 (OL)
export type Measurement = {
  kind: 'resistance' | 'voltage';
  between?: [string, string];       // resistance: node names as in candidate A
  node?: string;                    // voltage: red probe node, black on GND
  unit: 'ohm' | 'V';
  predictions: Prediction[];        // [A, B]
  separation: number;               // >= 3 settles it
  instruction: string;              // ready-to-show text
  unplugSupply?: true;              // resistance only valid with the supply disconnected
};
export type TopologyMeasurement = Measurement & {
  poweredSafe: boolean;             // false => never show a power-on step
  decisive: boolean;                // separation >= 3
  safety: string;                   // "DO NOT power ..." when !poweredSafe
  voltageOption: Measurement | null; // best powered alternative; null unless both candidates are safe
};

export type TopologyResponse = {
  result: {
    candidates: [TopologyCandidate, TopologyCandidate];
    measurement: TopologyMeasurement;
    trace: { step: 'topology'; provider: 'local'; model: 'mna-dc'; durationMs: number; status: 'ok' }[];
  };
};
export type TopologyErrorCode = 'BAD_JSON' | 'INVALID_REQUEST' | 'NOT_CONFIRMED' | 'INVALID_GRAPH';
export type TopologyError = { error: { code: TopologyErrorCode; message: string; details?: string[] } };
// HTTP: 200 TopologyResponse | 400 BAD_JSON | 422 the other three codes.
```

Suggested UI state (not implemented):

```ts
export type TopologyExplorerState =
  | { phase: 'pick'; graph: CircuitGraph; confirmed: boolean; pair: { a: string | null; b: string | null } }
  | { phase: 'loading'; request: TopologyRequest }
  | { phase: 'ready'; request: TopologyRequest; result: TopologyResponse['result'];
      showPowered: boolean;                       // may only be true when result.measurement.poweredSafe
      reading: { kind: 'resistance' | 'voltage'; value: number | 'OL' } | null }
  | { phase: 'verdict'; request: TopologyRequest; result: TopologyResponse['result'];
      matches: 'A' | 'B' | 'neither' | 'inconclusive' }  // pick the candidate within sigma; neither => both wrong
  | { phase: 'error'; request: TopologyRequest | null; error: TopologyError['error'] | { code: 'NETWORK'; message: string } };
```

Rendering rules the engine implies: never render a power-on instruction or `voltageOption` when `poweredSafe` is false; show `unplugSupply` as a prominent step; treat `decisive: false` as "no single reading settles this"; pre-validate that both pair nodes exist, differ, and the graph is user-confirmed before enabling submit.
