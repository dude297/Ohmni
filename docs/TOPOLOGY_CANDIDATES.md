# Dual-candidate topology probing

## Purpose
A schematic photo can be ambiguous at one junction: wires that cross without a dot, or a smudged tee. The image cannot settle this, and a model cannot either. A meter reading on the real circuit can. This feature builds both wirings and picks the single measurement that tells them apart. It prefers a **power-off resistance** check, because a connectivity question is a continuity question. The code in `src/lib/topology/candidates.ts` is pure and deterministic and makes no model calls. It is the "top next step" from `docs/research/TOPOLOGY_NEXT.md` (#45). The only part it reuses from #39 is the merge from `mergeDelta`.

## API
`POST /api/topology`
```json
{ "graph": <CircuitGraph>, "userConfirmed": true, "ambiguous": { "a": "VOUT", "b": "GND" } }
```
- **`200`** returns `{ result: { candidates: [A, B], measurement, trace } }`.
  - `A` is the graph as read. `B` is `a` and `b` merged, with `alias` mapping the vanished node to its survivor (GND always survives). Any resistor left with both leads on one node is dropped.
  - `shortsSupply` is set when the merge puts both terminals of a source on one node.
- **`measurement`** (`Discrimination`) contains:
  - `kind`: `'resistance'` (with `between: [x, y]`) or `'voltage'` (with `node`, black probe on GND).
  - `predictions` per candidate. For resistance, `openSupplyValue` is the reading when the supply is unplugged rather than shorted.
  - `separation`, plus `decisive` (separation ≥ 3).
  - `instruction`, `safety` and `poweredSafe`.
  - `voltageOption`, the best powered alternative. It is `null` when either candidate would short the supply.
- **Errors** use the same codes and shapes as `/api/probe`:
  - `400 BAD_JSON`
  - `422 INVALID_REQUEST` (including unknown or identical `a`/`b`)
  - `422 NOT_CONFIRMED`
  - `422 INVALID_GRAPH`

Example (divider 5 V, 10k/10k, ambiguous VOUT–GND): "With power OFF, measure resistance between VOUT (R1's lead) and GND: ≈5 kΩ (≈10 kΩ if the supply is unplugged) means VOUT and GND not connected; ≈0 Ω means VOUT and GND connected."

## Method
- **`equivalentResistance(g, n1, n2, 'short' | 'open')`** uses nodal analysis on the resistors only.
  - Voltage sources are shorted (union-find merges their terminals) or removed (`'open'`).
  - Only the part of the network connected to `n1` is kept.
  - It injects a 1 A test current at `n1` with `n2` as reference, so R = V(n1). The result is `Infinity` if the nodes are not connected and `0` if they are the same node.
- **Resistance options** cover every pair of physical nodes (named as in A, and mapped through `alias` for B), with the ambiguous pair first.
  - Separation = |Ra − Rb| / (σa + σb), where σ = 2 % + 1 Ω.
  - It is taken as the **minimum over shorted and unplugged supply**. A powered-off bench supply is neither a reliable short nor a reliable open, so the reading has to separate A and B either way.
  - **Fallback:** if no pair is decisive under both conventions (e.g. the supply sits across the ambiguous pair, so a shorted supply reads 0 Ω either way), the check is re-ranked with only the open-supply prediction and comes back with `unplugSupply: true`. Its instruction tells the user to disconnect one supply lead.
- **Voltage options** come from `solveDC` on each candidate (σ = 2 % + 10 mV, same as `src/lib/probe`).
  - They are offered only if every candidate is safe to power: no collapsed source, no `SolveError`, and every source current ≤ 0.5 A.
- **Pick:** the resistance option with the highest separation, if it is decisive. Otherwise the voltage option, but only if it separates better and is safe.

## Limits
- One ambiguity at a time and exactly 2 candidates (A, B).
- Only the **merge** direction (open → joined). Splitting a joined node needs to know which terminals sit on which arm, which needs crop/arm data (see TOPOLOGY_NEXT §a).
- DC resistive circuits only (`resistor`, `dc_voltage`). Ideal meter apart from σ. The 0.5 A "short" threshold and the 1 Ω lead resistance are fixed.
- No posterior update from the reading yet: the caller compares the reading with `predictions`. Feeding it into `probeStep` as topology hypotheses is the next step.

## How the UI could use it
When extraction flags a junction (e.g. #39's `assessTopology` suspect), call `/api/topology` with the two nodes. Show the A/B card with `measurement.instruction` and an "enter reading" box, and highlight `safety` in red when `poweredSafe` is false. Take the candidate whose prediction is nearest the reading (both `value` and `openSupplyValue` count). Swap that graph in and require the user to re-confirm before `/api/solve`.
