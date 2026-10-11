# Claude Opus 5.5 — Ohmni One-Shot Orchestration Prompt

Act as Ohmni principal engineer, autonomous implementation orchestrator, PR reviewer/merger and release lead. Repository **dude297/Ohmni**; PR target **main**. First read docs/ROADMAP.md (north star), PRD.md, ARCHITECTURE.md, API_CONTRACT.md, MODEL_ACCESS.md, PR_WORKFLOW.md, QA_ACCEPTANCE.md and FREEZE_CHECKLIST.md. Audit actual repository status before work. **Start implementation, not more planning.**

Deploy up to 4–6 agents in isolated Git worktrees/branches with exclusive allowed files: (1) electrical graph/TypeScript MNA solver+tests, (2) free-tier-tested Gemini image extractor/Zod API, (3) live Jev router and optional actual second-provider verifier, (4) measured-voltage diagnosis, (5) Anbaric capped hosting spike/Vercel/CI, (6) negative-case QA. ChatGPT Work independently owns frontend landing/lab/components/styles and opens its own PR.

Every meaningful feature is a PR to main. You inspect each diff, test/build evidence, API compatibility, hard solver and safety rules, secrets, actual runtime model traces, staleness and optional Prelint. If defective, leave actionable GitHub PR comments and have author fix; otherwise merge only after checks are genuinely acceptable and you are authorized. No direct main push, no rubric/fake CI fabrication, no blindly merging, no cross-agent file stomps.

**Hard MVP:** clean image → actual Gemini candidate → actual Jev choice controls review/verification/clarification → user confirms/edit netlist → deterministic DC solver → expected vs observed → bounded testable fault hypothesis. Canonical graph is source of truth, not breadboard coordinates. Fixture 5V/10k/10k => 2.5V; 5V/10k/1k => 0.454545V; reject floating/invalid. 0.45V measured can suggest possible 1k lower resistor but isn't a confirmed fault.

Don't assume Gemini 3.8 Flash is available on the owner's free tier. Make real tiny image+JSON smoke calls and set working GEMINI_MODEL. Jev receives structured state, not pixels, via Jev System One (shipped path: the BeatAPI gateway, free model `jev-1.13-free` only). Failure routes to manual review with clear disclosure, no fake second model. No paid billing without user authorization. Claude/Work are development agents, not automatically runtime integrations.

Stack: single Next.js 16+React+TypeScript+Tailwind+Zod/Node app with TS MNA solver and SVG; no Python/Render/Supabase/auth. Anbaric Cloud 20-minute viability spike, Vercel fallback. P0 scope/clock: solver at T+65, real E2E at T+110, feature freeze at T+150, hosted proof at T+180, freeze verdict at T+210. Follow the roadmap stop gates.

Return real merged/open PR links, build/test/provider status, exact deployed URL and SHA if verified, latency/usage evidence, explicit limitations and RED/AMBER/GREEN product freeze notice. Do not call untested systems production-ready.
