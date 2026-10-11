# Ohmni UI recovery handoff

Repository: https://github.com/dude297/Ohmni
Base: c884d2febc9fe6d204d49aa760493319a348702f
Local branch: feat/interactive-evidence-workspace-recovery
Review, merge, and deployment owner: Claude.

## Changes ready for review

- Solver-backed Probe Guide, a labeled three-resistor ladder sample, suggested-node highlighting, predicted outcomes, removable observations, retry, fit warnings, and explicit single-fault/model-relative probability limits.
- The demo uses actual `/api/probe` requests: B = 0 V recommends probing A; A = 5 V isolates the modeled R2-open fault.
- Graph edits and measurement edits clear the investigation; responses arriving after its removal cannot restore an obsolete highlight.
- Hero resistance exploration distinguishes a local preview from a confirmed backend solve. Node targeting, graph zoom, image inspection, real demo-image uploads, measured/predicted comparison, and JSON solve-evidence download.
- Scroll reveals, progress, back-to-top with focus handling, hover feedback, reduced motion, and readable content without JavaScript.
- `docs/moonshot_proposals.md` captures five future directions and the bounded implemented Probe Guide.
- Provider-neutral pipeline wording matches Claude's Groq-primary merge. Actual returned traces retain model/provider/status/duration/route/confidence/usage/note.

## Claude's latest handoff checked

PR #30 merged Groq-primary extraction with Gemini fallback. Claude reported production build c884d2f and a live 12/12 smoke result. His `CHATGPT_WORK_UI.md` and `MOONSHOT.md` request the Probe Guide frontend, trace evidence, and readable rate-limit/upload errors. Backend, shared types, provider configuration, and API routes were not changed by this recovery.

## Verification and provenance

The completed earlier workspace ended at commit 700c9f8b8e19027f4aca16e3ebdddd4d7686e260. Its recorded validation shows 121/121 tests, lint, typecheck, a production webpack build, 44 Chromium checks, and zero Axe violations across six desktop/mobile surfaces. Browser checks include actual numerical solves, probe narrowing/undo, stale-response rejection, reduced motion, and no-JavaScript readability. Only HTTP 429/503 recovery cases were mocked. No successful live provider call was claimed by that UI QA.

This Windows recovery restores the recorded source edits onto main c884d2f. It adds a guard that shows Probe Guide only with backend results. Fresh verification: 121/121 tests pass after placing the test temporary files inside the workspace; UI-scoped ESLint passes; TypeScript passes using main's generated route declarations. The full Next build/type generation could not be repeated because Windows sandbox denied the native compiler's path canonicalization. The earlier build/browser results are evidence for the completed original workspace, not new browser results for this recovery. Hosted CI and browser validation remain required on this recovery before merging.

## Publication authorization

The user explicitly authorized publishing this branch and opening its PR in this chat. Claude retains review, merge, and deployment ownership. This handoff does not claim that the UI has been deployed.
