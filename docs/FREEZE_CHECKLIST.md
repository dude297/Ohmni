# Ohmni — Freeze Gate

**Documentation freeze** means roadmap, ownership, architecture, contracts and prompts agree. **Product freeze** means the real deployed software meets tested P0 criteria. Never conflate them.

### P0 checks (all need evidence)
- [ ] Correct main build SHA, relevant reviewed/merged PR links; no unresolved P0.
- [ ] Public hosted URL works in incognito; /api/health responds from server.
- [ ] Actual image→Gemini candidate extraction, with tested free-tier model ID.
- [ ] Actual Jev decision controls route; contrasting routes evidenced. If unavailable, essential multimodel demonstration NOT proven.
- [ ] Explicit netlist review/edit followed by numerically verified solver.
- [ ] 2.500000V and 0.454545V tests plus floating/invalid rejection passed.
- [ ] Observed 0.45V mismatch produces only hypothesis and next safe measurement.
- [ ] Errors/quotas, secrets, upload limits, no fake model trace tested.
- [ ] Mobile/desktop and 3-minute demo tested; backup recorded and labeled.
- [ ] Actual latency/usage measured, economics source-known or labeled unknown; submission limitations explicit.

### Decision
RED = core live proof absent, app unavailable, or P0 broken. AMBER = hosted but any judging/demo gate missing, explicitly qualified. GREEN = all P0 proven with artifact links, lead signs off SHA.

**Audit 2026-10-11: RED / NOT PRODUCT FREEZE-READY (docs-only repo).**

### Freeze notification template
OHMNI FREEZE STATUS: [RED/AMBER/GREEN]
Commit and URL: [actual SHA / verified URL]
PRs/review/checks: [links/outcomes]
Gemini + Jev: [actual tested IDs/route evidence]
Solver/negative tests: [actual output]
Demo/incognito/mobile: [actual result]
Latency and marginal cost: [measured/estimate/unknown]
P0 blockers: [explicit]
Deferred P1/P2: [explicit]
Owner/date and next permissible actions: [explicit]

At ROADMAP T+150, stop feature work. Only P0 fixes with evidence and redeploy after feature freeze.
