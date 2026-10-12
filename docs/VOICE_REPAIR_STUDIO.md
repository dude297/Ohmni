# Voice Repair Studio (experimental integration)

Merged through [#69](https://github.com/dude297/Ohmni/pull/69). The local source/test observations below do not establish a hosted voice workflow or real microphone verification.

Route: `/for-the-larp/voice-lab`. Default circuit: 12 V loaded bridge (measure C).

Flow: speak/type two readings, the Probe Guide ranks faults, `/api/repair` proposes a simulated fix (before/after per node),
the user approves the plan (Ohmni changes nothing physical), then a third reading at `verification.node` goes to
`/api/repair/verify`. The VERIFIED badge appears only when that response has `verified: true`.

Safety kept from Voice Lab: circuit confirmed by click only; every reading needs an explicit "yes, record that" (or button)
that applies only to the proposal currently on screen and same circuit revision; corrections ("no, change it to 5.2 volts")
replace the pending value and re-confirm; the post-fix reading is also confirmed before it is checked.
All narration is built from API results. The listening light is decorative, not audio amplitude. Push-to-talk only; typed fallback always.

Verification status: real microphone UNVERIFIED (Playwright used a FAKE SpeechRecognition and the typed path).
Playwright ran against the real `/api/repair*` merged from moonshot/repair-engine. Screenshots: `docs/ui-review/voice-repair-studio/`.
