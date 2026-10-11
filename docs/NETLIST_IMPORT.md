# Netlist import (exact-topology path)

Post-submission moonshot. Code: `src/lib/netlist/**` (pure TS, browser-safe, no deps). Tests: `tests/netlist/**`. Fixtures: `fixtures/netlist/**` (synthetic).

```ts
importNetlist(text, { measureNode?, format? }) -> {
  graph: CircuitGraph | null, warnings: string[],
  rejected: { line, text, reason }[], format: 'spice' | 'kicad',
  errors: string[]   // validateGraph errors (extra field)
}
```

Format is auto-detected (`(export` => KiCad, else SPICE) unless `opts.format` is set. The result feeds the same `solveDC` / review flow as an image extraction, but the topology is exact, not inferred.

## Policy: never silently change the circuit

- Any rejected line => `graph: null` (a partial graph would be a different circuit). Each rejection carries line, text and reason.
- The graph is run through `validateGraph`; failures (floating subcircuit, no source, unknown measureNode, R <= 0) => `graph: null` and `errors` filled. Nothing is repaired.
- Ignored-but-harmless directives (`.tran`, `.ac`, `.print`, ...) are listed in `warnings`.

## SPICE subset

- Comments: lines starting `*` or `;`, inline `;`. Continuation: lines starting `+`. Case-insensitive; node names are upper-cased, `0` and `gnd` => `GND`. `.end` stops parsing; `.op` and `.title` ignored.
- Line 1 is the title (classic SPICE) unless it is a well-formed R/V line.
- `R<name> n1 n2 value`, `V<name> n+ n- [DC] value` (n+ = positive). Extra parameters (`tc=`, ...) are rejected.
- Rejected with reason: C L D Q M I J K E F G H B S W T, `X` instances, `.subckt` blocks (and everything inside), `.model/.param/.include/...`, AC/SIN/PULSE/PWL/EXP sources, duplicate names (case-insensitive), unparseable values.
- measureNode: `opts.measureNode`, else a `* ohmni:measure NODE` comment, else the first non-ground node with a warning.

## KiCad netlist (.net, s-expression, KiCad 6/7 `export (version ...)`)

- Components from `(components (comp (ref) (value)))`, nets from `(nets (net (name) (node (ref) (pin))))`. Multi-sheet designs are already flattened by KiCad.
- Net names: leading `/` stripped (other `/` kept, e.g. `sub/VOUT`); `GND`, `GNDA`, `0` (any case) => `GND` (they merge); unnamed (`Net-(R1-Pad2)`, `unconnected-(...)`) => `N1`, `N2`, ... in file order, skipping names already in use.
- Refs `R*` => resistor, `V*` => dc_voltage (value `12V`, `12`, `DC 12`). `#PWR`-style refs are skipped with a warning. Everything else (C, U, J, TP, H, ...) is rejected: if a board has parts we cannot model, we do not guess.
- Each supported part must have exactly 2 connected pins. **Assumption:** V pin 1 = +, pin 2 = - (matches KiCad `Simulation_SPICE:VDC`); V pins must be named `1` and `2`. Resistors are symmetric.
- measureNode: `opts.measureNode` (leading `/` optional), else first non-ground net with a warning (KiCad netlists have no comment channel).

## Values

Case-insensitive SPICE suffixes: `f p n u µ m k meg g t`. **`m` is milli, `meg` is mega** (`1M` = 1 mΩ as in SPICE; `1MEG` = 1 MΩ); `f` is femto, not farad; `mil` is rejected. A bare `m`/`M` suffix on a resistor adds a warning ("`1M` is milli-ohm in SPICE; did you mean 1MEG?"). Trailing units ignored: `ohm(s)`, `V`, `volt(s)`, `Ω`, `R`. Exponents (`1e3`) OK.

RKM (IEC 60062, digit-letter-digit) follows the standard, not SPICE: the letter is the decimal point. `4k7` = 4700, `4R7` = 4.7, `2G2` = 2.2e9, **`1M5` = 1.5e6 (uppercase M = mega)**, `1m5` = 1.5e-3 (lowercase m = milli), `1Meg5` = 1.5e6. RKM never warns.

## Limits

DC resistor/voltage-source networks only. No subcircuit expansion, parameters (`.param`), expressions (`{...}`), or current sources. A netlist with any unsupported part is refused whole, by design.

## Future UI (owned by ChatGPT Work)

Add "Import netlist" next to image upload: accept `.cir/.sp/.net/.txt` or paste. Call `importNetlist`; on `graph` go straight to the existing review step (no vision call, `requiresHumanReview` still applies to measureNode choice). On `rejected` / `errors` show the list with line numbers; offer a measureNode picker populated from the graph's nodes when a fallback warning is present.

## Why this is the exact-topology path

Image extraction is probabilistic and degrades as drawings grow or span sheets. A netlist already encodes connectivity, so a 40+ resistor or multi-sheet KiCad design imports with no inference step; the solver result is then only as wrong as the netlist. Tested: the 7-resistor loaded bridge expressed as SPICE and as KiCad both reproduce `LOADED_BRIDGE_12V` node voltages (A 7.342412, B 4.087354, C 2.608949), and a generated 41-component ladder imports and solves.
