# Ohmni moonshot proposals

Proposal date: October 11, 2026. These are proposed capabilities, not a release announcement. Current implementation, provider evidence and release gates remain authoritative in ROADMAP.md, API_CONTRACT.md, MODEL_ACCESS.md and the reviewed source. No proposal changes the October 11 feature freeze or authorizes paid model billing.

## North star

Ohmni becomes an investigator that designs experiments, gathers evidence and narrows a fault. The reusable foundation is a human-reviewed circuit graph, validated mathematics, actual observations and an explanation of what to check next. Potential users extend from EE labs and makers to embedded teams, repair and manufacturing; customer demand and willingness to pay remain hypotheses.

## 1. Probe here next: adaptive fault isolation

**User problem:** a single observation often supports multiple physical faults. A plausible explanation is not a confirmed diagnosis.

**Proposal:** simulate bounded candidate faults, compare their predictions, choose the next safe measurement that best distinguishes them, and update the remaining candidates after each user-entered observation. Explain why that measurement matters. Do not invent probabilities or equate residual ranking with calibrated confidence.

The current divider is a useful illustrative case:

| Candidate fault | Predicted VOUT | Distinguishing evidence |
|---|---:|---|
| R2 is 1 kΩ; R1 is 10 kΩ; supply is 5 V | 0.454545 V | Isolated R2 resistance |
| R1 is 100 kΩ; R2 is 10 kΩ; supply is 5 V | 0.454545 V | Isolated R2 resistance |
| Supply is 0.9 V; both resistors are 10 kΩ | 0.450000 V | Supply voltage |

**Judge moment:** Ohmni states that the 0.45 V reading cannot identify the fault, highlights a supply measurement, and narrows the candidates after a new observation. Then it requests a power-disconnected, isolated resistance check. The two resistor hypotheses cannot be separated by VOUT alone.

**Smallest credible demonstration:** existing three candidate hypotheses, a bounded deterministic decision rule, manual entry of a second observation and a visible investigation history. It must evaluate the observation rather than merely mark a task completed.

**Longer-term version:** instrument-aware test selection with measurement uncertainty, accessible test points, candidate fault coverage and experimentally evaluated information gain.

**Acceptance:** the next test separates at least two candidates; actual observations change the result; contradictory/out-of-range data is handled; graph edits invalidate the investigation; no claimed certainty outside the candidate set. Coordinated backend contract and UI work is required.

**Implementation update:** The reviewed backend from PR #25 is now connected through the Probe Guide UI. The ladder example uses actual solver requests: B = 0 V recommends A, and A = 5 V isolates the modeled R2-open fault. Probabilities are model-relative and the single-fault DC scope remains explicit.

## 2. Two possible circuits, one question: topology uncertainty

**User problem:** a crossing or missing junction dot can change connectivity, even when component recognition is correct.

**Proposal:** retain alternative graph interpretations for an unresolved crossing, validate each, calculate their distinct predictions and request the specific close-up or measurement needed to resolve them.

**Judge moment:** a highlighted crossing expands into two candidate graphs. One answer resolves the uncertainty and the selected graph proceeds through explicit user confirmation.

**Smallest credible demonstration:** one explicitly reviewed crossing with bounded alternatives. Do not claim general dense-schematic recognition. Invalid/floating candidates should be rejected visibly rather than given invented voltages.

**Acceptance:** alternatives differ in electrical connectivity, not just visual placement; solver results come from the actual candidate graphs; provenance and the deciding observation are retained; unresolved topology never silently becomes a confirmed graph.

**Longer-term version:** region crops, reconciliation across connected image regions, hierarchical sheets, named nets and component provenance. Native design inputs should be preferred to image inference where available.

## 3. The circuit is correct, the firmware is not: cross-domain reconciliation

**User problem:** an incorrect software reading can originate in ADC conversion, a reference voltage, pin selection or scaling rather than the physical circuit.

**Proposal:** reconcile a schematic, narrowly supported firmware and recorded measurements. Compare predicted electrical behavior with the conversion expression and identify a supported discrepancy with line-level evidence.

**Judge moment:** a meter agrees with the circuit prediction but application output does not. Ohmni points to a conversion expression and demonstrates a checked correction on a defined test case.

**Smallest credible demonstration:** one MCU/ADC format, one supported conversion pattern and actual meter/capture data. A replay must be labeled as recorded evidence. Code findings remain hypotheses until tested.

**Acceptance:** ADC resolution/reference assumptions are explicit; the parser does not execute arbitrary uploaded code; the numerical transformation is tested; hardware and software evidence are distinguishable; unsupported patterns fail honestly.

**Longer-term value:** embedded bring-up workflows and a potential path to engineering-team licenses. Commercial value is not yet validated.

## 4. Run the experiment: instrument-connected investigation

**User problem:** copying measurements between tools interrupts debugging and loses provenance.

**Proposal:** choose a capture, show its purpose, request user approval, obtain data from a supported instrument and update the investigation from the actual capture. Start with imported recorded CSV before automatic hardware control.

**Judge moment:** a real capture changes which hypothesis remains plausible; the UI links the conclusion to the recording and test configuration.

**Smallest credible demonstration:** real recorded data import with format/units validation and source labels. Do not animate a fake instrument connection or call recorded data live.

**Longer-term version:** approved capture control through instrument APIs and integrations, instrument configuration provenance and repeatable test recipes. Saleae's Automation API is a possible integration path through Logic 2; it requires the software and is not unrestricted real-time access to raw data.

**Acceptance:** no uncontrolled actuation, explicit measurement limits, disconnected-device handling, capture timestamps/units, safe supported test configurations and actual data-dependent decisions.

## 5. Trace the symptom across the whole design: engineering evidence graph

**User problem:** diagnosis requires correlating multiple sheets, board connectivity, component records, firmware and measurements.

**Proposal:** link hierarchical schematics, PCB connectivity, BOM, datasheets, firmware and observations in an evidence graph. Every conclusion points to supporting sources and assumptions. Import native connectivity instead of pretending photos expose buried multilayer traces.

**Judge moment:** clicking a symptom follows an evidence trail across a sheet, a component, firmware and an observed measurement.

**Smallest credible demonstration:** a tightly scoped design with native netlist input, component identity and a genuine measurement trail. KiCad's exported netlists offer a structured starting point; supported formats require validated adapters.

**Longer-term version:** permissioned team investigations, revision comparisons, manufacturing test history and reuse of resolved fault cases. A potential moat is a high-quality, consented corpus of which experiments resolved which faults, plus integration into engineering workflows. Neither the corpus nor commercial defensibility exists merely because it is proposed.

**Acceptance:** stable identities across revisions, source provenance, permission/privacy boundaries, validated connectivity mapping and no inference of invisible physical connections as fact.

## Recommended hackathon sequencing

1. Stabilize the existing real image → model route → human review → deterministic solver → hypothesis path.
2. Prefer a bounded version of adaptive fault isolation if backend ownership and tests are available before freeze.
3. Consider one topology-alternative demonstration only after the core path and the first experiment loop are verified.
4. Present firmware reconciliation, instruments and engineering evidence graphs as future proposals until implemented and independently checked.

No time estimate is a delivery guarantee. The moonshot pitch is: **Ohmni tells you what to check next, and shows how each measurement changes the diagnosis.**

## Sources and limits

- Measurement strategy research: https://arxiv.org/abs/2512.23527 — a research foundation, not evidence that Ohmni implements optimal test selection or has a unique algorithm.
- KiCad netlist exports: https://www.kicad.org/discover/schematic-capture/ — evidence of an integration starting point, not an existing Ohmni adapter.
- Saleae API overview: https://www.saleae.com/support/extensions-api/automation-api/saleae-api-and-sdk — evidence of an instrument automation path and its software/raw-data limitations, not an existing Ohmni integration.

Sources reviewed October 11, 2026. No claim that these proposals are first-of-their-kind. Differentiation must be demonstrated in the integrated product and evaluated with real users.
