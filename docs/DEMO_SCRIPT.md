# Ohmni 3-minute demo script

Prod: https://multimodal-hackathon-sage.vercel.app. Rehearse once. Jev's free tier allows 1 call/min, so do not run two extractions back to back (wait 60 s).

Prep: open `/` and `/lab` in tabs; have `public/samples/clear-divider.png` and `public/samples/ambiguous-junction.png` ready (both are in the repo; if missing, use any clean 10k/10k divider schematic image and skip the ambiguous beat). Extraction is limited to 6 per minute per IP and Groq's free plan allows about 3 per minute, so keep to the scripted uploads.

| Time | Do | Say |
|---|---|---|
| 0:00-0:20 | On `/`, show the hero "Your circuit has a problem. Find out why." | "You expect 2.5 V, your meter says 0.45 V. Which part is wrong, and what do I check next?" |
| 0:20-0:50 | Click **Upload your schematic** (or go to `/lab` and use the **Upload a schematic** zone) and pick `clear-divider.png`. Wait for "Reading your circuit...". | "Gemini reads the pixels and proposes a candidate graph. It is only a candidate." |
| 0:50-1:20 | Open **Model Orchestration** at the bottom. Point at the rows: Gemini extract (model, ms, tokens), then Jev (returned route `review_extraction`). | "Jev never sees the image or does math. It reads a structured summary and picks the route. Real model, latency and tokens; nothing simulated." |
| 1:20-1:40 | If present and 60 s have passed: upload `ambiguous-junction.png`. Point at "Image interpretation needs review", the unresolved connections, and the different returned route (`verify_topology` or `ask_user`). | "Same pipeline, different input, different route. Clear goes straight to review; ambiguous triggers verification or asks me." Skip this beat if the file or rate slot is not there. |
| 1:40-2:00 | In **02 Review**, check component values and nodes, then tick **I verified values, terminals and ground**. | "A human confirms before any math. Edits clear the confirmation." |
| 2:00-2:35 | In **03 Understand**, click **Use demo reading: 0.45 V** (or type 0.45), then **Analyze & compare**. Show the expected VOUT 2.50 V and the top hypothesis "R2 may be 1 kΩ instead of 10 kΩ" with its next measurement. | "The local MNA solver gives 2.5 V exactly. 0.45 V is consistent with a 1 kΩ lower resistor. That is a hypothesis: measure R2 isolated, power disconnected." |
| 2:35-3:00 | Reopen the trace; point at the footer safety note. | "All calls are on free plans; paid Jev is refused in code. Cost per diagnosis and accuracy are not measured yet, so we claim only what the trace shows. DC resistive circuits only." |

## 20-second backup (provider rate-limited or down)

1. Say: "Providers are free-tier; here is the honest failure." Show the trace row with status `error` or `skipped` and route `ask_user`. Do not claim multimodel proof for that run.
2. Click **Load sample** (or **Build a manual divider**), tick the confirm box, click **Use demo reading: 0.45 V**, then **Analyze & compare**. The solve and hypothesis still work; the trace states no providers ran.
3. If you show a recorded run, label it "recorded".

## Likely judge questions

**Where is multimodel essential?** Gemini turns pixels into a graph; Jev decides trust routing from structured state; Groq is the vision fallback (used when Gemini is rate-limited or unavailable) and the topology verifier. The solver is deliberately not an LLM. Development use of Claude/ChatGPT is not counted.

**Is it accurate?** Not measured at scale. We verified the divider end to end on production (exact graph, 2.5 V, correct top hypothesis) and the solver has fixtures. Two models agreeing is not proof, hence the confirmation gate.

**What does it cost, will people pay?** Everything runs on free plans, so charges are $0 here, but that is not a production cost. Jev's free tier is 1 call/min, so scale needs paid tiers priced from measured tokens. Willingness to pay is an untested hypothesis; the next step is a lab/instructor pilot.
