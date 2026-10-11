# Ohmni — Future Product Roadmap (not the hackathon deadline)

Public homepage product vision; the October 11 2026 5:30 PM PDT release gate still lives in ROADMAP.md. Stages two through four are plans, **not live features** and contain no release date commitments.

## Guiding idea
**Schematic-first.** Separate uncertain image interpretation from validated electrical mathematics. The confirmed `CircuitGraph` remains authoritative for the supported DC domain; later adapters must supply their own numerical, topology, safety and provenance tests.

| Phase | Truthful public status | Work | Users / value | Promotion gate |
|---|---|---|---|---|
| 01 Understand | Available now, limited | Resistor/DC-source schematics; editable graph; MNA; measurement comparison; fault hypotheses | EE classrooms, makers, prototype debugging | Real API demos, tests, and negative-case review |
| 02 See denser | Planned | Image-region cropping, junction/crossing indicators, component provenance, graph reconciliation and targeted human questions | Engineering worksheets, dense circuit schematics, repair | Exact connectivity evaluation on labeled benchmark images |
| 03 Simulate more | Research | Capacitors, inductors, nonlinear, AC, transient, SPICE or vetted specialist solvers | Embedded engineering, power and analog design | Domain-specific validated solver, model limits and reference cases |
| 04 Connect workflows | Exploration | Breadboard and PCB/EDA imports; lab reports; test equipment; permissions and team review | Hardware teams, manufacturing QA, field repair | Privacy/security analysis, integration accuracy, workflow pilots |

## The three public demos
1. **Divider** `/lab?sample=divider`: **real backend** on hand-defined 5 V, 10 kΩ + 10 kΩ graph; 2.50 V expected. A 0.45 V external measurement gives hypotheses; an example graph is not evidence of model image extraction.
2. **Series + parallel** `/lab?sample=network`: 12 V, 100 Ω series, 200 Ω || 300 Ω in parallel; expected midpoint `72/11 ≈ 6.5454545 V`. Uses the server solver, not client divider math.
3. **Ambiguous crossing** `/lab?upload=1`: actual user-supplied image. Jev may request a clarification based on live confidence/validation errors; do not fabricate a route or claim it succeeded without provider evidence.

## Honesty and safety
Dense diagrams, arbitrary breadboards, PCB, AC, transients and nonlinear elements remain explicitly out of scope for current automatic analysis. Never infer a missing wire with false confidence. A syntactically valid model output isn't electrical topology proof. Do not use AI to advise work on dangerous energized systems. Shipping more features is contingent on validated test sets and real production evidence, not marketing.

## Architecture scalability
New **inputs** (camera/crops/CAD) convert to a candidate graph and undergo human review; new **physics** domains use suitable separately tested mathematical engines; the review, provenance, comparison, and next-step experience can be reused. Future institutional/customer value and economics are hypotheses, not measured traction.
