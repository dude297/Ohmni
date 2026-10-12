// Browser walk of /twin against a running `npm run start` (REAL /api/twin and /api/repair/verify, no mocks).
// Usage: BASE=http://localhost:3355 node tests/twin-ui/e2e.mjs   (playwright is resolved from %TEMP%\ohmni-e2e)
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const base = process.env.BASE ?? "http://localhost:3355";
const out = process.env.OUT ?? "docs/ui-review/twin";
const { chromium } = await import(pathToFileURL(join(process.env.TEMP, "ohmni-e2e/node_modules/playwright/index.mjs")).href);
const assert = (c, m) => { if (!c) throw new Error("ASSERT: " + m); };
const b = await chromium.launch();
const results = [];

for (const [tag, vp] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
  const p = await b.newPage({ viewport: vp });
  const errs = [];
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  p.on("pageerror", (e) => errs.push(String(e)));
  const shot = (n) => p.screenshot({ path: `${out}/${n}-${tag}.png` });
  const text = () => p.locator("body").innerText();

  await p.goto(`${base}/twin`);
  await p.getByRole("button", { name: /Loaded bridge/ }).waitFor();
  assert(/INTENDED \(source: KiCad netlist\)/.test(await text()), "intended badge");
  await shot("1-design");

  await p.getByRole("button", { name: /Next: describe my hardware/ }).click();
  await p.getByRole("button", { name: /R6 is 6.8/ }).click();
  assert(!(await p.getByRole("button", { name: /Compare with the design/ }).isEnabled()), "compare blocked until reviewed");
  await p.getByLabel("I reviewed the observed circuit").check();
  assert(/EXAMPLE/.test(await text()) && /OBSERVED \(human-reviewed\)/.test(await text()), "example + observed badge");
  await shot("2-reality");

  await p.getByRole("button", { name: /Compare with the design/ }).click();
  await p.getByText("680 Ω → 6.8 kΩ").first().waitFor({ timeout: 15000 });
  const n1 = await p.locator(".tw-num", { hasText: "Node N1" }).locator(".tw-n2").innerText();
  const vout = await p.locator(".tw-num", { hasText: "Node VOUT" }).locator(".tw-n2").innerText();
  await shot("3-diff");

  await p.getByRole("button", { name: /Next: where should I measure/ }).click();
  await p.locator("[data-next-node]").first().waitFor();
  const first = await p.locator("[data-next-node]").first().getAttribute("data-next-node");
  await shot("4-measure");
  const feed = async (node, v) => {
    await p.locator("#tw-rn").selectOption(node);
    await p.locator("#tw-rv").fill(v);
    await p.getByRole("button", { name: "Add reading", exact: true }).click();
    await p.getByText(`${node}:`).first().waitFor({ timeout: 15000 });
  };
  await feed("VOUT", parseFloat(vout).toFixed(3));
  const second = await p.locator("[data-next-node]").first().getAttribute("data-next-node").catch(() => null);
  if (second) await feed(second, parseFloat(n1).toFixed(3));
  await p.getByRole("button", { name: /See the fix/ }).click();
  await p.getByText(/restore/).first().waitFor();
  const fix = (await p.locator(".tw-fix").innerText()).replace(/\s+/g, " ");
  assert(/R6/.test(fix) && /MEASURED/.test(fix) && /SIMULATED/.test(fix), "fix card badges: " + fix);
  await shot("5-fix");

  await p.getByRole("button", { name: /Approve plan/ }).click();
  const expect = Number((await p.getByText(/^Expect /).innerText()).match(/Expect ([\d.]+) V/)[1]);
  await p.locator("#tw-vv").fill("0.5");
  await p.getByRole("button", { name: "Verify", exact: true }).click();
  await p.getByText("NOT VERIFIED").waitFor({ timeout: 15000 });
  await p.locator("#tw-vv").fill(String(expect));
  await p.getByRole("button", { name: "Verify", exact: true }).click();
  await p.locator(".tw-v-ok").waitFor({ timeout: 15000 });
  assert((await p.locator(".tw-v-ok b").innerText()) === "VERIFIED", "verified");
  await shot("6-verify");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  results.push({ vp: tag, firstProbe: first, then: second, vout, n1, expectVolts: expect, overflow, errors: errs });
  await p.close();
}

// wiring-fault diff screenshot (1440)
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${base}/twin`);
  await p.getByRole("button", { name: /Next: describe my hardware/ }).click();
  await p.getByRole("button", { name: /R6 wired to GND/ }).click();
  await p.getByLabel("I reviewed the observed circuit").check();
  await p.getByRole("button", { name: /Compare with the design/ }).click();
  await p.locator("[data-reroute]").first().waitFor({ timeout: 15000 });
  results.push({ wiring: await p.locator("[data-reroute]").first().getAttribute("data-reroute") });
  await p.screenshot({ path: `${out}/3-diff-wiring-1440.png` });
  await p.close();
}
await b.close();
console.log(JSON.stringify(results, null, 1));
