// Browser check (Playwright installed OUTSIDE the repo): node tests/ui/guided-lab.e2e.mjs <screenshot-dir> against `next start -p 3107`.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE = "http://localhost:3107";
const OUT = process.argv[2];
const browser = await chromium.launch();
const log = (...a) => console.log("OK", ...a);
const calls = [];

for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (r.url().includes("/api/")) calls.push(`${label} ${r.method()} ${new URL(r.url()).pathname}`); });
  const shot = (name) => page.screenshot({ path: `${OUT}/${label}-${name}.png`, type: "png" });

  // Homepage
  await page.goto(BASE + "/");
  assert.equal(await page.locator(".reading-progress, .back-to-top").count(), 0);
  await shot("home-top");
  await page.mouse.wheel(0, 2200); await page.waitForTimeout(400);
  const header = page.locator(".site-header-bar");
  assert.equal(await header.evaluate((el) => getComputedStyle(el).position), "sticky");
  const box = await header.boundingBox(); assert.ok(box && box.y <= 1, "nav sticks to top");
  await page.locator("#who-its-for").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById("who-its-for").scrollIntoView());
  await page.waitForTimeout(500);
  const h = await page.locator("#audience-heading").boundingBox();
  const hb = await header.boundingBox();
  assert.ok(h.y >= hb.y + hb.height - 1, `audience heading not covered by nav (${h.y} vs ${hb.height})`);
  await shot("home-audience");
  for (const name of ["Probe Guide", "Under the Hood"]) assert.equal(await page.getByRole("link", { name }).count(), 1);
  log(label, "homepage sticky nav + audience + links");

  // Lab
  await page.goto(BASE + "/lab?sample=divider");
  const current = () => page.locator('.investigation-steps [aria-current="step"] strong').innerText();
  assert.equal(await current(), "Review");
  assert.ok(await page.getByRole("button", { name: /Compare/ }).first().isDisabled());
  assert.ok(await page.getByRole("button", { name: "Continue to compare" }).isDisabled());
  await shot("lab-review");
  // Back to Capture and forward (no model calls)
  await page.locator(".investigation-steps button", { hasText: "Capture" }).click();
  assert.equal(await current(), "Capture");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "stage-title-0");
  await shot("lab-capture");
  await page.getByRole("button", { name: "Review circuit" }).click();
  assert.equal(await current(), "Review");
  // Confirm and go to compare
  await page.getByText("I verified values, terminals and ground").click();
  await page.getByRole("button", { name: "Continue to compare" }).click();
  assert.equal(await current(), "Compare");
  assert.match(await page.locator('[aria-live="polite"].sr-only').innerText(), /Step 3 of 4/);
  await page.getByRole("button", { name: /Use demo reading: 0.45 V/ }).click();
  // Back preserves edits: edit R1 then go forward/back
  await page.getByRole("button", { name: "Back" }).filter({ visible: true }).click();
  assert.equal(await current(), "Review");
  const r1 = page.getByLabel("R1 value in ohms");
  await r1.fill("12000");
  // Edit after confirm invalidates confirmation
  assert.equal(await page.locator('.confirmation input[type="checkbox"]').isChecked(), false);
  assert.ok(await page.getByRole("button", { name: "Continue to compare" }).isDisabled());
  await page.locator(".investigation-steps button", { hasText: "Capture" }).click();
  await page.getByRole("button", { name: "Review circuit" }).click();
  assert.equal(await r1.inputValue(), "12000", "edit preserved across stages");
  await r1.fill("10000");
  log(label, "back preserves edits; edit-after-confirm invalidates");
  await page.getByText("I verified values, terminals and ground").click();
  await page.getByRole("button", { name: "Continue to compare" }).click();
  assert.equal(await page.locator("#measured-vout").inputValue(), "0.45", "measurement preserved");
  await page.getByRole("button", { name: /Analyze & compare/ }).click();
  await page.locator(".result-card").waitFor();
  assert.match(await page.locator(".voltage-result").innerText(), /2\.500/);
  await shot("lab-compare");
  await page.getByRole("button", { name: "Investigate the difference" }).first().click();
  assert.equal(await current(), "Investigate");
  await page.getByRole("button", { name: /Guide me/ }).click();
  await page.locator(".next-probe, .probe-conclusion").first().waitFor({ timeout: 15000 });
  await shot("lab-investigate");
  // Leave and return: probe state preserved, result preserved, no extra calls
  const before = calls.length;
  await page.locator(".investigation-steps button", { hasText: "Compare" }).click();
  await page.locator(".investigation-steps button", { hasText: "Investigate" }).click();
  assert.equal(await page.locator(".next-probe, .probe-conclusion").count() > 0, true, "probe readings kept");
  assert.equal(calls.length, before, "navigation made no API calls");
  // Editing measurement after result clears result -> Investigate locked
  await page.locator(".investigation-steps button", { hasText: "Compare" }).click();
  await page.locator("#measured-vout").fill("0.5");
  assert.ok(await page.locator(".investigation-steps button", { hasText: "Investigate" }).isDisabled());
  log(label, "4 stages, solve 2.500 V, probe guide, navigation is API-free");

  // ask_user: intercepted in the browser (never reaches the server or a model)
  await page.route("**/api/extract", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    route: "ask_user", trace: [],
    extraction: { inputKind: "schematic", requiresHumanReview: true, warnings: ["R2 value is obscured in the image."], unresolvedConnections: ["R2 value could not be read"],
      graph: { schemaVersion: 1, groundNode: "GND", measureNode: "VOUT", components: [
        { id: "V1", kind: "dc_voltage", value: 5, positiveNode: "VIN", negativeNode: "GND" },
        { id: "R1", kind: "resistor", value: 10000, positiveNode: "VIN", negativeNode: "VOUT" },
        { id: "R2", kind: "resistor", value: 10000, positiveNode: "VOUT", negativeNode: "GND" }] } } }) }));
  await page.goto(BASE + "/lab?upload=1");
  assert.equal(await current(), "Capture");
  await page.getByRole("button", { name: "Smudged value" }).click();
  await page.locator(".needs-input").waitFor();
  assert.equal(await current(), "Review");
  assert.ok(await page.locator('.confirmation input[type="checkbox"]').isDisabled(), "cannot confirm before resolving");
  assert.ok(await page.getByRole("button", { name: "Continue to compare" }).isDisabled());
  assert.ok(await page.locator(".investigation-steps button", { hasText: "Compare" }).isDisabled());
  assert.equal(await page.locator('.error-card[role="alert"]').count(), 0, "ask_user is not a red error");
  await shot("lab-needs-input");
  await page.getByLabel("R2 value in ohms").fill("1000");
  for (const box of await page.locator('.review-warnings input[type="checkbox"]').all()) await box.check();
  await page.getByText("I verified values, terminals and ground").click();
  assert.equal(await page.locator(".needs-input").count(), 0);
  assert.ok(await page.getByRole("button", { name: "Continue to compare" }).isEnabled());
  log(label, "ask_user blocks Compare until edited + verified + confirmed");
  assert.deepEqual(errors, []);
  await ctx.close();
}
console.log(calls.join("\n"));
assert.equal(calls.filter((c) => c.includes("/api/extract")).length, 2, "only the two browser-intercepted ask_user extracts");
await browser.close();
console.log("ALL PASSED");
