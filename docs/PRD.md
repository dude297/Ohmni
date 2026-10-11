# Ohmni — MVP Product Requirements

## Who and why
Primary user: EE/ECE student or teaching lab diagnosing a simple low-voltage DC circuit. Secondary: hobbyist and hardware prototyping engineer. The user needs to reconcile intended schematic, actual readings and possible component/wiring mistakes without rebuilding every circuit manually in an editor. **Commercial willingness-to-pay and saved time are hypotheses, not validated claims.**

## Honest positioning
**Ohmni turns readable schematics into verifiable electrical graphs, then helps investigate what is wrong.** Dense diagrams, arbitrary PCB/breadboard extraction and AC/nonlinear components are deferred. The forward-looking homepage product roadmap is [PRODUCT_ROADMAP.md](PRODUCT_ROADMAP.md), distinct from actual delivery gates.

## Job to be done
Upload a clean schematic; extract symbols, values and connections; review/correct the representation; compute known expected behavior; enter an external measurement; receive ranked *testable* hypotheses and a safe next measurement, with optional EE explanation.

## Must work (P0)
- Public site without auth; instant sample circuit and image upload.
- Image upload <=5MB PNG/JPEG/WebP, real model response; ambiguities visibly recorded.
- Real Jev routes between at least review and clarification (second-provider verify only if accessible). Hard invalidity always forces correction.
- Edited component value/node assignments affect the reviewed graph; explicit user confirmation before solve.
- Deterministic DC solver correct on 5V, 10k/10k => 2.500000V; 5V, 10k/1k => 0.454545V; floating and malformed networks reject.
- User enters 0.45V for the expected 2.5V case; system proposes that an incorrectly valued lower resistor *could* explain it and recommends measuring isolated resistance with power disconnected. Do not claim the physical fault is proven.
- Visible real provenance, route, model IDs and latency; no fake success under quota failures or timeout.
- Graceful error states, secrets server-side, reasonable upload limits, no high-voltage advice.

## P1 and non-goals
P1: refined original UI and one additional actual model verification path; standard breadboard coordinate-view adapter if P0 green. Deferred: arbitrary breadboard photo extraction, complex handwritten schematics, PCB layers, full SPICE/AC/transients, custom CAD, 3D, authentication, persistence.

## Buyer/test hypothesis
Initial EE lab/instructor pilot: measure time to find simple component/connection errors and instructor interventions vs current approach. Potential education/institutional license and later team plans. Do not invent pilot data, pricing traction or subscription economics.

Acceptance and freeze controlled by ROADMAP.md and FREEZE_CHECKLIST.md.
