// Ohmni per-analysis cost model. No deps.
// Usage: node scripts/cost-model.mjs [--gemini-in=$/1M --gemini-out=$/1M --groq-in=.. --groq-out=..]
// Prices accessed 2026-10-11. Gemini 3.5 Flash and Groq qwen/qwen3.8-27b paid prices are "not listed"
// on the official pages -> null, never guessed. Pass them via flags once confirmed.
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split("=")[1]) : null; };
const P = { // USD per 1M tokens
  gemini: { in: arg("gemini-in"), out: arg("gemini-out") }, // not listed: ai.google.dev/gemini-api/docs/pricing
  groq: { in: arg("groq-in"), out: arg("groq-out") },       // not listed: groq.com/pricing
  jev: { in: 0.042, out: 0 },                               // LISTED: beatapi.io/jev-api (jev-1.13, output free)
};
const T = { // tokens per call
  gemini: { in: 1310, out: 106, src: "measured, clean divider run; thinking tokens (590 in one probe) NOT included" },
  jev: { in: 475, out: 49, src: "measured" },
  groq: { in: 1310, out: 106, src: "ASSUMED = Gemini tokens (Groq usage not recorded)" },
};
const cost = (m) => (P[m].in == null || P[m].out == null ? null : (T[m].in * P[m].in + T[m].out * P[m].out) / 1e6);
const S = {
  "clear (Gemini+Jev)": ["gemini", "jev"],
  "ambiguous (Gemini+Jev+Groq verify)": ["gemini", "jev", "groq"],
  "Gemini fails (Groq+Jev)": ["groq", "jev"],
};
const f = (x) => (x == null ? "not listed" : "$" + x.toFixed(7));
console.log("| Scenario | Jev | Gemini | Groq | Paid total / analysis |\n|---|---|---|---|---|");
for (const [n, ms] of Object.entries(S)) {
  const parts = ms.map(cost);
  const sum = parts.reduce((a, b) => a + (b ?? 0), 0);
  const total = parts.some((p) => p == null) ? `incomplete (>= ${f(sum)}, Jev only)` : f(sum);
  const c = (m) => (ms.includes(m) ? f(cost(m)) : "-");
  console.log(`| ${n} | ${c("jev")} | ${c("gemini")} | ${c("groq")} | ${total} |`);
}
console.log("\nFree-plan usage charges per analysis: $0.00 (all three on free plans)");
// Ceilings: Jev 1 successful call/min before top-up (listed); Groq free 30 RPM/1K RPD/8K TPM/200K TPD (listed);
// Gemini 3.5 Flash limits not listed in docs (AI Studio only).
const groqTpm = Math.floor(8000 / (T.groq.in + T.groq.out)), groqTpd = Math.floor(200000 / (T.groq.in + T.groq.out));
console.log("Binding free ceiling (Jev 1 call/min, 1 Jev call per analysis): 1 analysis/min = 1440/day");
console.log(`Groq-only caps (assumed tokens): ${groqTpm}/min by TPM, ${groqTpd}/day by TPD, 1000/day by RPD`);
console.log("Tokens: " + Object.entries(T).map(([k, v]) => `${k} ${v.in} in/${v.out} out [${v.src}]`).join("; "));
