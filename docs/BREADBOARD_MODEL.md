# Breadboard connectivity model

Canonical, deterministic model of "what is physically wired" on a solderless breadboard. Code: `src/lib/breadboard/` (import from `@/lib/breadboard`). Pure TS, no UI, no model calls. Fixtures in `fixtures/breadboard/` are **SYNTHETIC** hand-authored builds, not photos.

## Model

- `HoleId` is an explicit string. Main grid `a1`..`j30` (half) or `j63` (full): rows a-e are the top half, f-j the bottom half, separated by the centre channel. Rails `L+1`.., `L-1`.., `R+1`.., `R-1`.. (side, polarity, index along the rail; 25 holes on a half board, 50 on a full one).
- A **strip** is the unit of continuity: each 5-hole column half (`col12-top` = a12..e12, `col12-bot` = f12..j12) and each rail segment (`rail-L+-s0`). `BoardSpec.railBreakAfter: [25]` splits rails after hole 25 (presets: `HALF_BOARD`, `FULL_BOARD`, `FULL_BOARD_SPLIT_RAILS`; `railSegments` is informational, `railBreakAfter` is authoritative).
- A **net** = strips joined by **jumpers only** (union-find). A component pin never joins strips. Proximity and wire crossing/routing in 3D mean nothing: only the two end holes of a jumper matter.
- Net ids are `net:<first strip id>`.

## API

- `stripsOf(board)`, `stripOf(board, hole)` (null for invalid holes).
- `buildNets(state) -> { nets, errors }`: errors for invalid holes (placements, jumpers, ground, probes), two pins in one hole, duplicate refdes.
- `toCircuitGraph(state, opts?) -> { graph, netOfPin, errors, warnings, nodeOfNet, probeNodes }`
  - Ground net (`groundNet` hole) is `GND`. Nets holding a `probeHoles` label take that name; the rest are `N1..Nk` by first pin use. `opts.nodeNames` (netId -> name) overrides, `opts.measureNode` picks the measure node (default: first probe label).
  - `netOfPin` keys are `'R6.positive'`. `probeNodes` maps probe label to the graph node name (a probe on the ground net maps to `GND`).
  - Warnings: `X.pin: unconnected pin` (net with a single component pin); `X: component shorted by placement` (both pins on one strip/net; a shorted resistor is omitted from the solve, which is exact; a shorted supply is an error). Probe on a pin-less net.
  - `graph` is null if there is any error or `validateGraph` fails. `nodeOfNet`, `probeNodes` are additive extras.
- `diffAgainstIntended(intended, build) -> { componentDiffs, connectionDiffs, identical, uncertainties }`
  - Components match by refdes (`missing`, `extra`, `kind_mismatch`, `value_mismatch`).
  - Intended nodes map to physical nets by terminal incidence (majority; GND pinned to the declared ground net; ties broken by probe label, then first terminal, and recorded in `uncertainties`). Resistor leads are symmetric, so a flipped resistor is not a diff.
  - `connectionDiffs[]`: `{ componentId, terminal, intendedNode, observedNode, holes, kind: 'wrong_net' | 'short' }`. `holes` are the physical holes to highlight: the pin plus the other terminals of the same intended node (where it should go); for a `short`, also the jumper endpoints touching the shorted strips (the stray wire).

## Limits

- No physical photo understanding. Every hole must be explicit (human-confirmed or UI-placed). Never tell a user to move something unless that hole was confirmed.
- Models only resistor and DC supply (what the solver supports). No polarity, no hidden/loose contacts, no non-ideal rail splits beyond `railBreakAfter`, no mini boards, rail length fixed per board size.
- Intended-node matching is a heuristic when a build is badly wrong (ties are flagged, not hidden).

## How /studio uses it

The 3D studio holds a `BuildState`. On every edit: `toCircuitGraph` gives the solvable graph plus warnings (render `unconnected pin` / `shorted` markers on the listed pins); `solveDC` gives node voltages mapped back via `probeNodes`/`nodeOfNet`; `diffAgainstIntended` against the intended graph yields `connectionDiffs[].holes` to highlight and `componentDiffs` for missing/wrong parts.
