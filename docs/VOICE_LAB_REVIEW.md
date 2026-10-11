# Voice Lab readiness review (Moonshot C, draft PR #56)

Reviewed: `src/app/for-the-larp/voice-lab/**` at `e5dc2d8` on `origin/feat/voice-lab-experimental`.
Local review branch: `moonshot/voice-lab-review` (nothing pushed, no PR, no deploy, no paid transcription, no model calls; `/api/explain` was only ever served by a Playwright mock).

**Real microphone / real speech recognition: UNVERIFIED.** All "voice" evidence below used a fake `SpeechRecognition` injected by Playwright (it drives `onresult`/`onerror`/`onend`). Chrome/Edge cloud STT accuracy, real permission prompts and real `speechSynthesis` output were not exercised. Use the 30-second owner test below.

## Verdict

**Can be shown as an optional experiment: YES, with conditions.** Isolation is clean. It must not be linked from the core lab until P1 items F1-F4, F10, F13, F14 are fixed (all small). Nothing here can corrupt or commit a reading without an explicit Confirm click, so the failure mode is "wrong value on a confirm card", not "silent wrong record".

Isolation facts (checked):
- Diff vs base `bdfa2e1` touches only `src/app/for-the-larp/voice-lab/**`, `tests/voice-lab/**`, `docs/**`, demo assets. No other `src` file imports it, and no page links to it (`/`, `/for-the-larp`, `/probe` HTML contain no `voice-lab`).
- It only reads shared modules (`app/probe/helpers`, `lib/circuit/types`, `lib/probe`, `components/ohmni/brand`); none were modified.
- CSS: every selector in `voice-lab.css` is `vl-` prefixed, so no leakage into other routes.
- Bundle (`npm run build`, Next 16 prints no per-route sizes, so measured from the emitted HTML's script chunks, raw / gzip): voice-lab 597 KB / 186 KB; /probe 595 / 185; /lab 616 / 192; / 586 / 182. 7 of 8 chunks are shared; voice-lab-only chunks are about 41 KB raw / 15 KB gzip. Other routes' bundles are unchanged because nothing imports voice-lab.
- Routes: `/for-the-larp/voice-lab` is statically prerendered; `/`, `/for-the-larp`, `/probe` still return 200 locally.

## Checks (local branch)

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (exit 0, no output) |
| `npm test` | pass: 20 files, 233 passed, 18 expected-fail (the new known-bug tests) |
| `npm run build` | pass, 13 static pages |

## Findings

Severity: P0 = silent wrong data / safety, P1 = wrong value or wrong behaviour a user can plausibly hit (the confirm card is the only safety net), P2 = polish / safe failure. **No P0 found.**

| ID | Sev | Where | Evidence | Suggested fix |
|---|---|---|---|---|
| F1 | P1 | `parser.ts:92,97` (unit normalisation), `:177-193` | STT often emits "m v", "millie volts", "mili volts". `vout is 0.45 m v` -> **0.45 V** (no range warning); `450 millie volts` -> 450 V. A 1000x unit error whose only guard is the card. Tests `F1a-c`. | Treat a stray `m`/`milli*`/`mili*`/`millie` token adjacent to `v`/`volts` as mV (or ask). Also reject unknown tokens glued to a unit. |
| F2 | P1 | `parser.ts:115` (STOP), `:159` (non-number words ignored) | `five thousand millivolts` -> **5 mV** ("thousand" silently dropped; real value 5 V). `5 thousand volts` -> 5 V. Test `F2`. | Add `thousand` (and `k`) to number grammar or return "ambiguous". Rule: any magnitude word not understood must clarify, never be dropped. |
| F3 | P1 | `parser.ts:159-171` | `two and a half volts` -> **2 V**; `six and a half volts` -> 6 V (and "half a volt" correctly asks). Tests `F3`, `F3b`. | Reject `half`/`quarter`/`and a` inside a number context (clarify), or implement `and a half`. |
| F4 | P1 | `parser.ts:22` comment, `:115` (`to` in STOP) | "two point five" is commonly heard as "to point five" / "too point five" / "for point five": all parse as **0.5 V** (5x low). Tests `F4a/b`. | A `to/too/for` token immediately before `point` must trigger a clarification ("Did you mean 2.5?"), not be dropped. |
| F10 | P1 | `voice-lab.tsx:353` (card shown only for `confirming`/`listening`), `:209-214`, `machine.ts:66` | Realistic event order (error and end as separate tasks): card-mic `no-speech`/`audio-capture`/`network` dispatches `fail` -> phase `error` -> **confirm card disappears while the proposal stays armed**. Playwright: card count 1 -> 0. Test `F10`. User sees the transcript gone but a later "unknown" reply silently resurrects the card. | In `fail` keep `phase: s.proposal ? "confirming" : "error"`, or render the card whenever `proposal` exists. |
| F13 | P1 | `voice-lab.tsx:132-147` | `runExplain` has no revision/graph check. Start Explain, switch circuit, response arrives: explanation for the OLD circuit is shown under the NEW one (Playwright, mocked endpoint, 1.2 s delay). The circuit picker is not disabled while `expBusy`. | Capture `s.revision` before the await and drop the result if `stateRef.current.revision` changed; also disable picker on `expBusy`. (`doCommit` already does this correctly, `:119`.) |
| F14 | P1 | `voice-lab.tsx:141` | `if (r.explanation) speak(summary)` ignores `r.grounded`. An explanation the API marks NOT grounded (numbers not matching the solver) is **read aloud** while the screen badge says "Not grounded". Playwright: spoken = `STALE-EXPLANATION...` with `grounded:false`. | Speak only when `r.grounded`; otherwise speak "Explanation is not verified against the solver; see screen." |
| F6 | P2 | `parser.ts:26` | Fractional mV -> V is off by 1 ulp for 24,940 of 99,999 two-decimal values (0.03 mV -> 0.000029999999999999997). Integer mV are exact (20,000 checked). Physically irrelevant, but the payload carries ugly floats. | `Number(\`${value}e-3\`)`. Test `F6`. |
| F7 | P2 | `parser.ts:27` | `fmtNum(12345)` -> "12350" (4 s.f. rounding applies to integers); `0.12345` shows `0.1235`. Card hides a digit the user said. | Use `toPrecision(6)` or print the parsed value verbatim on the card. |
| F5 | P2 | `parser.ts:169` | Sign only recognised before the number: `0.3 volts negative` -> +0.3; `not 2 volts` -> +2. | Clarify when `not/negative` appears after the number. |
| F9 | P2 | `machine.ts:60-63` | A duplicate `commit_start` (double tap) flips an in-flight `processing` to `error` ("Already recording"); no duplicate network call (blocked in `doCommit`), just a UI flicker. Test `F9`. | Return `s` unchanged when already `processing`. |
| F11 | P2 | `machine.ts:111-125`, `voice-lab.tsx:402` | The API safety line ("Low-voltage DC only ... Disconnect power before measuring resistance ...") is displayed but **never spoken**. Spoken recommendations are safe on their own (voltage-only, "with the circuit powered, black probe on GND"), so this is hands-free completeness, not a hazard. | Speak `probe.safety` once, e.g. when the first "Measure node X next" is read. |
| F12 | P2 | `voice-lab.tsx:212,244-252` | Esc while the card mic listens aborts -> `aborted` -> `cancel` -> the pending reading is discarded along with the mic. Matches the "Esc cancels" hint, but a user who only wanted to stop the mic loses the card. | Make `aborted` only stop listening; Esc twice discards. |
| F8 | P2 | `parser.ts:106-113` | Safe-failure gaps: "yeah that's right", "yes please", "what's next", "four hundred and fifty millivolts", "which node next" are not understood (asks instead). "two thousand five hundred millivolts" is refused (safe). | Optional: loosen the phrase regexes (`^(yes|yeah)\b`), accept "and". |
| F15 | P2 | `voice-lab.tsx:172` | Saying "explain" triggers a model call (`/api/explain`) with no confirmation; server abuse guard applies. Not exercised here. | Fine for an experiment; gate behind the button only if cost matters. |

### Things that work (evidence)

- **Number grammar**: `oh/nought point four five`, `point four five`, `zero point four five`, `4 point five`, `forty five`, `forty-five`, `four hundred fifty millivolts`, `twenty five hundred millivolts`, `1,200 millivolts`, `minus/negative`, `.45` all parse correctly. `naught point four five` (no unit) asks "volts or millivolts?". `zero` needs no unit. `four five`, `three three`, `four fifty`, `1e3`, `1.2.3`, two numbers, volts+millivolts, `2 thousand 5 hundred` all clarify instead of guessing.
- **Decision, fractions**: "half a volt" is NOT supported; it asks. (See F3: the unsafe part is "and a half" being silently truncated.)
- **0.45 V vs 4.5 V vs 45 V vs 0.45 mV**: four distinct values (0.45, 4.5, 45, 0.00045 V). The UI card shows value and unit in large text ("0.45 V", "4.5 V", "45 V", "0.45 mV = 0.45 mV (0.00045 V)"). Only 45 V trips the range warning on the 5 V divider, so **4.5 vs 0.45 depends entirely on the user reading the card**.
- **Nodes**: resolved against the current graph only (`node C` on the ladder -> "I don't see a node C ... VIN, A, B"; `vout` on the ladder -> unknown). `vout`, `v out`, `vee out`, `v-out`, `v. out`, `V out` map to VOUT; `v in` to VIN. **"output" is not an alias** (asks which node; decision: acceptable). `ay/bee/see` letter spellings are not supported (ask). GND/ground/`node gnd` is always rejected with the reference-probe message.
- **Article "a" vs node A**: `a is 2 volts`, `node a 2 volts`, `a, 2 volts`, `I read a 2 volts at b`, `b is a 2 volts`, `a reading of 2 volts at b`, `it reads a very low 0.1 volts at b` all resolve correctly; `is a 2 volts` and `the a node is 2 volts` ask. `a 2 volt reading at b` asks (two nodes). Residual risk: sentence-initial "a 2 volts" is read as node A (reasonable).
- **Confirmation**: no code path reaches `processing`/`observations` except `propose` then `commit_start` with a same-revision proposal. Typed or main-mic "yes" never commits (Playwright: chips stay 0, "press Confirm on the reading card" reply). Only the Confirm button or "yes" on the card's own mic/input commits. A corrected reading replaces the proposal. Selecting another circuit drops proposal and circuit confirmation. Circuit must be confirmed by click before mic/typing is enabled.
- **Stale commit**: `doCommit` drops the response if the revision changed (`voice-lab.tsx:119`); reducer refuses stale proposals (`machine.ts:40`); the picker is disabled while committing. (Explain is the gap, F13.)
- **Mic permissions** (fake recognizer): mic is never started on load; starts only on press. `not-allowed` -> persistent "Microphone access was denied" note + typed input focused/usable; `no-speech`, `audio-capture`, `network` each produce a specific message. Console clean through the whole flow (0 errors).
- **SpeechRecognition unavailable** (property deleted): "Speech recognition isn't available in this browser" note, no talk button, full typed flow works, console clean.
- **Mobile 390 px** (Playwright, touch emulation): no horizontal overflow on load, after the flow, or in typed mode. Confirm button 119x49 px, reachable and fully inside the viewport after scroll; card auto-scrolls into view. Screenshots in `%TEMP%\ohmni-vl-shots` (not committed).
- **Spoken safety**: spoken strings never include resistance/ohm/continuity (ladder flow unit test and live capture of `speechSynthesis.speak`). Every solver `nextMeasurement` that mentions resistance begins with "Disconnect power first" and Voice Lab only speaks the hypothesis title, never that text. Hypotheses are always worded "not a confirmed fault" / "hypothesis". Replies are built only from the confirmed reading plus `/api/solve` and `/api/probe` responses.

## Adversarial test results

`tests/voice-lab/adversarial.test.ts`: 69 cases, **51 pass, 18 `it.fails` (known bugs F1-F10, expected failures documented with correct assertions)**. When a bug is fixed its `it.fails` goes red; flip it to `it`. Full run: 233 passed / 18 expected-fail across 20 files.

Playwright (390 px, fake recognizer, `/api/explain` mocked): about 37 assertions, all pass except 4; the 4 failures are F10 (card vanishes after card-mic `no-speech`), F12 (Esc discards), F13 (stale explain shown), F14 (ungrounded explanation spoken). The script is `%TEMP%\ohmni-e2e\vl-review.mjs` (kept out of the repo).

## Owner-run 30-second real-mic test (Chrome or Edge, desktop or phone)

1. `npm run start`, open `http://localhost:3000/for-the-larp/voice-lab`. DevTools Network: filter `api`.
2. Click "I confirm this matches my circuit" (voice cannot). Confirm the mic indicator is OFF.
3. Press Push to talk, allow the mic. Say: "VOUT is two point five volts". Expect HEARD text and a card "I heard 2.5 V at VOUT. Correct?" with nothing recorded yet.
4. Press talk and say "VOUT is point four five millivolts" and check the card reads **0.45 mV**; then "VOUT is four hundred fifty millivolts" -> 450 mV (= 0.45 V). Watch for "m v" mis-hears (F1).
5. Press Say yes/no on the card, say "yes". Expect a spoken reply, a chip `VOUT 2.5 V`, and exactly two requests: `/api/solve`, `/api/probe`. No `/api/explain`.
6. Press talk and stay silent: expect the "didn't hear anything" message. Deny the mic in site settings and retry: expect the "denied" note.
7. Record what Chrome/Edge actually transcribed. Mark the result VERIFIED only if you did this with a real mic.

## What must be fixed before showing it

Must (about 1 hour total): F1, F2, F3, F4 (parser clarify-instead-of-drop), F10 (one-line `fail` reducer change), F13 (revision check in `runExplain`), F14 (speak only when `grounded`). Should: F6, F7, F11. Defer: F5, F8, F9, F12, F15. Fixes were not applied; the feature was not rewritten.
