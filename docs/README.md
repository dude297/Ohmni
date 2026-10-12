# Ohmni documentation

Start with the repository [README](../README.md). Source features, isolated branch tests and hosted-release evidence answer different questions; a passing build or branch preview is not production sign-off.

| Question | Document |
| --- | --- |
| What is implemented, and what remains experimental? | [Current state](CURRENT_STATE.md) |
| How do the providers, reviewed graph and deterministic solver connect? | [Architecture](ARCHITECTURE.md) |
| What are the exact request and response shapes? | [API contract](API_CONTRACT.md) |
| Which hosted builds and user journeys were actually verified? | [Dated release evidence](RELEASE_E2E_2026-10-11.md) |
| How do I rehearse the submission version? | [Four-minute release demo](DEMO_SCRIPT.md), [recorded evidence](demo/README.md) |
| How do I demonstrate the post-submission design? | [Living Schematic specification, three-minute storyboard and validation](ui-review/LIVING_SCHEMATIC.md) |
| How do I run or verify a deployment? | [Deploy and demo](DEPLOY_AND_DEMO.md), [Anbaric access](ANBARIC_DEPLOYMENT.md) |
| What are the engineering and safety acceptance checks? | [QA plan](QA_ACCEPTANCE.md) |
| How are ownership and review handled? | [PR workflow](PR_WORKFLOW.md), [Prelint integration](PRELINT_INTEGRATION.md) |
| What remains planned or unmeasured? | [Roadmap](ROADMAP.md), [product roadmap](PRODUCT_ROADMAP.md), [economics](UNIT_ECONOMICS.md) |

Experimental integration notes: [Voice Repair Studio](VOICE_REPAIR_STUDIO.md), [repair engine](REPAIR_STUDIO.md), [Studio](STUDIO.md), [breadboard connectivity](BREADBOARD_MODEL.md), [design comparison](DIGITAL_TWIN.md), [netlist import](NETLIST_IMPORT.md), [AC sandbox](AC_SIMULATION.md), [circuit review](CIRCUIT_REVIEW.md), [firmware ADC](FIRMWARE_ADC.md), [two-fault probing](MULTI_FAULT_PROBE.md), [CSV evidence](INSTRUMENT_EVIDENCE_MOONSHOT.md). Original branch/local-test descriptions in these notes do not establish a remote deployment.

Release reports, recordings, provider evaluations and older UI handoffs retain their original build/time attribution. Follow their links as historical evidence, not a current deployment inventory. The Living Schematic [#67](https://github.com/dude297/Ohmni/pull/67) and experimental integration [#69](https://github.com/dude297/Ohmni/pull/69) are merged source. Their test/merge status does not establish hosted user-flow verification or submission proof. This documentation pass changes no deployment configuration.
