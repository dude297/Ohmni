# Digital twin: design vs reality

`POST /api/twin` compares the confirmed **design** (KiCad/SPICE netlist or a `CircuitGraph`) with a human-confirmed **observed** graph (what was actually built), then asks the existing solver/probe/repair engines what the difference means. Local only: no model calls.

## Request

```json
{
  "intended": { "netlist": "...", "format": "kicad", "measureNode": "VOUT" },
  "observed": { "schemaVersion": 1, "components": [], "groundNode": "GND", "measureNode": "VOUT" },
  "observedProvenance": { "kind": "human_review", "note": "optional" },
  "userConfirmed": true,
  "observations": [{ "node": "VOUT", "volts": 0.81 }]
}
```

`intended` may also be a plain `CircuitGraph`. The observed graph is always human-confirmed first (`userConfirmed: true`); image extraction only proposes it.

## Response (`200 { result }`)

`intended {graph, provenance}`, `diff`, `intendedSolution`, `observedSolution` (null if the observed graph is invalid/unsolvable; reason in `diff.uncertainties`), `predictedVsMeasured[]`, `probe` (faults relative to the DESIGN), `repair` (only when `observations` given), `trace`.

Errors: `BAD_JSON` 400; `INVALID_REQUEST`, `NOT_CONFIRMED`, `INVALID_GRAPH`, `UNSOLVABLE` 422. Netlist rejections are `INVALID_REQUEST` with `details` = rejected lines.

## How the diff works

- Components match by refdes. Value diff when `|observed/intended - 1| > 1%` (`ratio` = observed/intended).
- Net names are ignored. Each observed node is mapped to an intended node by majority vote over the terminals of shared components (GND fixed). A rename alone is not a diff; swapped resistor leads are not a diff.
- A matched component terminal that lands on a node mapping to a different intended node is a `connectionDiff`.
- Ties, nodes touching only unmatched components, and split nets are reported in `uncertainties` (mapping `null`), never guessed. `identical` requires no diffs and no uncertainties.

## Limits

Netlist text is capped at 64 KB. The importer rejects unsupported directives (`.include`, `.lib`, ...) and never touches files. Majority voting is not graph isomorphism: small DC circuits only. Fixtures in `fixtures/twin/` are SYNTHETIC.
