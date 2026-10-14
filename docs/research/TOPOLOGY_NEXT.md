# Topology: next steps after #39 (research, not shipped)

Status: **research**. Builds on draft PR #39 (`research/topology-confidence-moonshot`: `docs/TOPOLOGY_MOONSHOT.md`, `src/lib/topology/crossings.ts` with `assessTopology` / `mergeDelta` / `cropRect`, `scripts/topology-probe.mjs`). Nothing here touches a route. Written 2026-10-11 against main `947eb06`. Note: the #39 "Phase 0" bug (`callGroq` ignoring `instruction`) looks fixed on main: `src/lib/ai/groq.ts:58` now sends `instruction`.

Ground rule carried over from #39: **a graph cannot tell you what the image connected.** Models can only point at *where* a reading is a judgement call. The things that settle it are a human looking at the drawing, or a measurement on the real circuit.

## (a) Dual-candidate topologies for an ambiguous crossing
**When.** `assessTopology` returns `verify_region` with a `dotless_crossing*` or `unclear_junction` suspect that has `measureDelta > 10 mV` or `Infinity`.

**Build the candidates.** For each consequential suspect J, cap 2 suspects, which gives at most 4 candidates:
- **A** is the graph as the model read it.
- **B** is J flipped. The *merge* direction (open → joined) already works: export the node-renaming core of `mergeDelta` as `mergeNodes(g, x, y) → {graph, alias: {y: x}}`.
- The *split* direction (joined → open) needs to know which component terminals sit on which arm. Extend `CROSSING_REPORT_PROMPT` with `arms: [{direction: "N|E|S|W", toward: "<componentId>.<pos|neg>"}]`. If the arms are missing or inconsistent, B cannot be built, and the card says "edit this junction manually" instead of guessing.
- Keep `alias` maps. A merged node vanishes from B, and its predicted voltage is the survivor's (`VOUT → GND` gives 0 V). Every comparison goes through the alias, so "measure VOUT" means the same physical wire under both candidates.

**Present both.** Use one card per junction. Show the crop (b), then a table of solver predictions for every node, computed by `solveDC` on A and B:

| | A: not connected (drawing convention: no dot) | B: connected |
|---|---|---|
| VOUT | 2.50 V | 0.00 V (merged with GND) |
| I(R1) | 0.25 mA | 0.50 mA |
| Note | | R2 is shorted out; R1 dissipates 4x (2x current) |

- Highlight rows where |A − B| > 2σ, using the meter model already in `src/lib/probe` (σ = 2 % + 10 mV). Those are the rows that matter.
- If B makes the source short (`mergeDelta = Infinity`), say "B would short the 5 V supply. Implausible for a working build, and **do not power it to test**."
- Nothing is pre-selected. The default label says which reading the *drawing convention* implies, not which one "the AI thinks". The user must pick A, B or "edit" before `userConfirmed` can be true, so `/api/solve` keeps its gate.

## (b) Crop-and-verify protocol
- **Crop geometry.** Use `cropRect(bbox, W, H)` with margin `max(6 %, 48 px)`. Enforce a source side of at least 160 px (#39 measured 160 px crops upscaled to 480 px: 4/4 correct). Rescale Groq's y-axis by W/H first, because #39 found y normalised by width. Also cut a **context crop** (2.5x the bbox) so the reader sees which wires lead away.
- **Two jittered crops per junction.** Offset ±8 % and scale 0.8/1.2. If the two disagree, the junction is `unclear`. This is a cheap self-consistency check, not a truth check.
- **Prompt asks only for observable facts, never "is it connected?"**, and never shows the first-pass graph, so the reader cannot anchor on it:
  `Look only at the centre of this crop. Return JSON {"arms": 2|3|4|null, "dot": true|false|null, "straightThrough": true|false|null}. null = cannot tell.`
- **Connectivity is derived in code from those facts.** A dot means joined. Four arms with no dot means open by convention. Three arms means a tee, which is joined, but it gets a flag when a dangling end is reported within 1 bbox.
- **Agreement rules (deterministic):**
  - *Crop facts agree with graph A* → record `evidence: "model-checked (crop)"`. The card is still shown if `measureDelta` > 10 mV, collapsed and pre-filled but unconfirmed.
  - *Crop contradicts A* → show the card expanded with a contradiction banner. B is first only in display order.
  - *Any null, or the two crops disagree* → `ask_user` with both candidates.
- **Model agreement is not truth.** Reasons:
  - Readers share failure modes: the same pixels, similar training data, and the same blurry dot.
  - Use a *different* provider for crops than for the full image when one is available (Groq full image, flash-lite crops).
  - The UI wording ladder is: `model-read` < `model-checked` < `confirmed by you` < `confirmed by measurement`. Only the last two may set `userConfirmed`. Never show a model's self-reported confidence as a probability.
  - Post-hackathon, a classical dot/line detector (Hough lines + blob) gives a witness that does not share model failure modes.

## (c) Confidence calibration on a labelled set
- **Label set v1.** The 10 existing `fixtures/circuits` renders plus 30–50 real photos and hand drawings. Label every junction: `shape`, `dot`, `connected`, bbox, and the arm → terminal mapping. Store it as JSON next to the images, with no PII.
- **Log one row per junction per run** (JSONL, offline script only, never production traffic without consent): `image_sha256, label_set_version, provider, model, prompt_version, temperature, reported{shape,dot,treatedAsConnected,bbox}, found(bool), crop{arms,dot,straightThrough}×2, derived_connected, assessor_escalation, measureDelta, truth{...}, human_choice (if in UI), latency_ms, tokens_in/out, http_status`.
- **Metrics, per provider × prompt version:**
  - **Junction recall**: labelled crossings that were reported.
  - **False-flag rate**: clean junctions escalated.
  - **Crop accuracy**: `dot` and `derived_connected`.
  - **Escalation precision/recall**: did `verify_region` fire exactly where the graph was wrong?
  - **Bbox error**: px after the W/H correction.
- **Sample sizes.** Report counts with a **Wilson 95 % interval**, never a bare percentage.
  - Zero errors in n trials only bounds the error rate at about 3/n (rule of three). 0/30 means "under ~10 %"; you need about 60 clean trials to claim under 5 %.
  - 47/50 correct is 94 %, with an interval of roughly 84–98 %.
  - #39's 4/4 crops and 5/6 surfacing are anecdotes, not rates.
  - Reliability diagrams (reported confidence vs accuracy) only once a provider has n ≥ 100 junctions.
- **What the UI may say.** "Crop checks on our label set v1: 47/50 correct (84–98 %)" is allowed. "95 % confident" from a model's self-report is not. Re-measure whenever the model ID or prompt version changes; the version string goes in every trace event `note`.

## (d) Probe guide that discriminates topologies, not just faults
Today `probeStep(graph, observations)` (`src/lib/probe/index.ts`) builds single-fault candidates from **one** graph and picks the node with maximum expected information gain. The math does not care where the candidates came from.

**Design.** Add an optional `candidates: {id, title, prior, graph, alias}[]` input. The hypotheses become `topology × {nominal, single faults}`. Priors are 0.5/0.5 on topology unless crop evidence exists; even then, cap any topology prior at 0.8 until calibration (c) exists. Observations are mapped through `alias` before the likelihood is computed. The posterior then says "A 97 % / B 3 %" from *measurement*, which is the only probability Ohmni is allowed to show.

**Prefer a power-off resistance test for topology.**
- A crossing question is a connectivity question, so the safest discriminator is continuity.
- Predict R(X, Y) per candidate with the existing solver: remove every `dc_voltage` (the user disconnects the supply, so it is open; a "switched-off" bench supply is not a reliable short) and drop components left floating, add a 1 V test source between X and Y, then R = 1 / |I_test|. A merged pair gives 0 Ω.
- Step order: (1) power off, ohmmeter between the two wires at J; (2) only if both candidates are safe to power (no `Infinity` short) **and** resistance did not separate them, fall back to the voltage step.
- Never instruct power-on when any live candidate shorts the source.

**API.** Do not loosen `/api/probe`.
- Add `candidates` (2–4 validated graphs) beside `graph`.
- Keep `userConfirmed: true`. Here it means "I confirm parts and values; one of these wirings is right".
- Add `mode: 'voltage' | 'resistance'` to `next`.
- When a topology reaches p ≥ 0.9, the UI swaps it in as *the* graph, and the user re-confirms before `/api/solve`.

**UX sketch.**
```
Junction J3 is ambiguous (no dot). It changes VOUT by 2.5 V.
[crop]  A: not connected (convention)   B: connected
Fastest check, power OFF: ohmmeter between the R2 top lead and the GND rail.
   A predicts ~10 kΩ (R2; supply disconnected)  ·  B predicts ~0 Ω          [ enter reading ]
→ 0.3 Ω entered → B 99 % (from your measurement). [Use B] [Edit]
```

## Top next step (smallest PoC, ~0.5 day, pure + tests, no model calls)
1. Export `mergeNodes` with an `alias` map.
2. Add `topologyCandidates(graph, assessment)`.
3. Add `predictResistance(g, x, y)`.
4. Extend `probeStep` with `candidates`.
5. Tests: on `ambiguous-junction`, the probe picks the resistance step and resolves A vs B in one reading; a source-short candidate never yields a power-on instruction.

Then wire the card behind a flag after the freeze.
