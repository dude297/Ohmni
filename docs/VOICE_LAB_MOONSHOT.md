# Ohmni Voice Lab — moonshot notes (`/for-the-larp/voice-lab`)

Status: **experimental, P2, isolated**. Not linked from navigation yet. Branch `feat/voice-lab-experimental`.

## What it is

You can troubleshoot hands-free while holding the probes. You press **push-to-talk**, say the reading, and confirm it explicitly. Ohmni then answers with text built only from `/api/solve` and `/api/probe`, highlights the next node to probe in the schematic, and can optionally read the answer aloud.

Flow: pick an example circuit → **you confirm the circuit** (voice never confirms a graph) → push-to-talk or type → typed parser → proposal card ("I heard **0.45** **V** at **VOUT**. Correct?") → **explicit Confirm** → `/api/solve` (expected voltages; `measuredVoltage` only when the node is the graph's `measureNode`) and `/api/probe` (every reading goes into `observations`) → grounded reply + next-node highlight → optional `speechSynthesis`.

Files (all under `src/app/for-the-larp/voice-lab/`):
- `parser.ts`: deterministic typed parser (`VoiceIntent`). It handles spoken numbers, units, and node aliases resolved only against the current graph. It returns a clarification question instead of guessing.
- `machine.ts`: reducer state machine (`idle/listening/processing/confirming/committed/error`), the commit guard with a stale-revision check, API payload building, and the grounded reply builder. Fetch is injected so it can be tested.
- `voice-lab.tsx`, `voice-lab.css` (plain CSS with the `vl-` prefix), and `page.tsx`.
- It reuses `schematicLayout`, `CIRCUITS` and `LADDER_5V` from `src/app/probe/helpers.ts` as read-only imports.

## Runtime models

**Voice Lab adds NO runtime transcription model.** Speech-to-text is the browser's built-in Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`). Ohmni receives only the transcript text and never receives or stores audio. In Chrome and Edge the browser vendor's cloud service performs the recognition, so it is **not guaranteed to be local or private**. Command parsing is deterministic TypeScript with no AI. The only model call is the existing optional **Explain** button (`/api/explain`, Gemini), which the user triggers and which shows its `grounded` flag.

## Safety invariants (enforced in code and tests)
- Readings and the graph are never auto-confirmed. Typed or spoken "yes" counts only when it comes from the proposal card's own input or talk button. A "yes" in the main command box is refused.
- Each proposal carries a `circuitRevision`. If the circuit changed after the proposal was made, the commit is refused. A result that arrives after the circuit changed mid-request is dropped.
- The probe node always comes from `/api/probe` `next.node` and is never invented. Hypotheses are always worded as "hypothesis, not confirmed fault", and the API's safety line is shown verbatim.
- Ambiguous input gets a clarification question and is never guessed. Examples: "four five", two numbers, two nodes, a missing unit for a non-zero value, an unknown node, GND as the measured node.
- Values beyond the supply plus 10 % (|v| > max source × 1.1) are flagged "Check your range".

## Phase 2: should Voice Lab use a server-side STT model?

Prices are from the official pricing pages as fetched on **2026-10-11**. No STT provider was called while building this, and nothing was paid for.

| Option | Cost (official, 2026-10-11) | Latency for a 2–4 s utterance | Device support | Privacy / retention | Integration complexity |
|---|---|---|---|---|---|
| **Web Speech API** (current) | $0 to us | Streaming interim results; typically sub-second after you stop speaking | Chrome, Edge, Safari (desktop and iOS, prefixed). **Not Firefox.** | Chrome/Edge send audio to the vendor's cloud. No retention controls for us. Ohmni never sees audio. | Lowest: no server, no keys. Typed fallback is required anyway. |
| **OpenAI** `gpt-4o-mini-transcribe` / `gpt-4o-transcribe` / `whisper-1` | $0.003 / $0.006 / $0.006 per min; `gpt-realtime-whisper` $0.017/min | Upload after release, so roughly 0.5–2 s round trip (not measured) | Any browser with `MediaRecorder` | Audio goes to OpenAI. API data is not used for training by default and has standard abuse-monitoring retention (check the current policy). | Medium: record a blob, send it to a new server route, keep the key server-side, add rate limits. |
| **Groq** `whisper-large-v3` / `-turbo` | $0.111/hr / $0.04/hr (≈ $0.00185 / $0.00067 per min). 10 s minimum billed length. **The free plan includes it**: 20 RPM, 2,000 RPD, 7,200 audio-s/hour, 28,800 audio-s/day. Documented WER 10.3 % / 12 %. | Very fast inference. Upload overhead dominates (not measured). | Any browser with `MediaRecorder` | Audio goes to Groq. | Medium. Same as OpenAI, and the repo already has a Groq key slot (`/api/health` lists `groq`). |
| **Deepgram** Nova-3 | Streaming $0.0048/min (Nova-3 mono, listed discount from $0.0077); pre-recorded $0.0043/min; $200 free credit | Streaming over WebSocket, well under a second (vendor claim) | Any browser | Audio goes to Deepgram | Higher: WebSocket proxy or short-lived tokens |
| **AssemblyAI** | Universal-Streaming $0.15/hr; Universal-3.6 Pro Realtime $0.45/hr; pre-recorded Universal-2 $0.15/hr, Universal-3.5 Pro $0.21/hr; $50 free credit. Streaming is billed on **session duration, idle time included**. | Streaming, sub-second (vendor claim) | Any browser | Audio goes to AssemblyAI | Higher: WebSocket and temporary tokens |

**Accuracy on what Ohmni needs (node ids, numbers, units).** Every engine is weakest on exactly what matters here: single letters ("A" vs "a"/"eh", "B" vs "be/bee"), "point" vs "pint", and "V" vs "we". General WER figures don't measure this. What protects us is the parser, not the engine. Nodes resolve only against the confirmed graph, ambiguity becomes a question, and every reading needs an explicit confirm. Whisper-family models and Deepgram/AssemblyAI accept a prompt or keyterm/boost list (e.g. `VOUT, VIN, node A, millivolts`). That is the most likely accuracy win over Web Speech, which has no reliable phrase-hint API in Chrome.

**Recommendation.** Keep Web Speech plus the typed fallback for the hackathon, since it adds no cost, no key and no server. If owners want Firefox support or better node and number accuracy, the cheapest next step is **Groq `whisper-large-v3-turbo` behind a new `/api/transcribe` route**. That route would take a ≤ 10 s push-to-talk `MediaRecorder` blob, send it with a prompt listing the graph's node names, add per-IP rate limiting like `/api/extract`, never persist audio, and send back text only. That route does not exist yet; it would be a separate reviewed PR. The rough cost is $0.00067/min, but the 10 s minimum billing means each utterance costs about $0.0001.

## Verified vs not verified
- **Verified by the agent:** the typed command path end to end on a local `next start` (Playwright Chromium at 1440×900 and 390×844), the parser and state machine (vitest), API payloads, grounded replies, and the fake-recognition event plumbing (an injected fake `SpeechRecognition`, only in the e2e harness).
- **NOT verified:** real microphone recognition in any browser. Playwright cannot provide a real mic. Real `speechSynthesis` audio output was not verified either.

### Owner 30-second manual test (Chrome or Edge, desktop)
1. Open `/for-the-larp/voice-lab` and pick **Voltage divider**. Click **I confirm this matches my circuit**.
2. Press **Push to talk** and allow the mic. Say "**V out is zero point four five volts**". The card should read `0.45 V at VOUT`.
3. Click **Say yes / no** on the card and say "**yes**". The reply should say the circuit predicts 2.5 volts and that the reading doesn't match. If "Speak replies" is on, it should be spoken.
4. Switch to **Resistor ladder** and confirm it. Say "**B is zero volts**", then press Confirm. Node **A** should be highlighted. Say "**node A five volts**", then press Confirm. The reply should conclude "Most likely: R2 open… hypothesis, not a confirmed fault."
5. Block the mic in site settings and press talk. You should see the "Microphone access was denied" message, with focus moved to the typed box. In Firefox, the page should show the typed-mode note.
