// CSP smoke: visits every page, clicks safe sample/example buttons, and fails on any CSP violation.
// Usage: node scripts/csp-smoke.mjs <baseUrl> [--force-enforce]
//   --force-enforce rewrites a Report-Only header to an enforcing one in flight, to test enforcement before deploying it;
//   CSP_OVERRIDE=<policy> (with --force-enforce) tests a candidate policy without rebuilding.
// Fails on any CSP violation or uncaught page error. Allowed: zod v4's eval feature probe (allowsEval: try { Function('') }
// catch): blocked, zod falls back to its non-JIT path. ponytail: z.config({ jitless: true }) in client code would silence it.
// Browser: CSP_PLAYWRIGHT_MODULE (file:// URL to playwright/index.mjs) and CSP_BROWSER_EXECUTABLE, else `playwright` + its Chromium.
const { chromium } = await import(process.env.CSP_PLAYWRIGHT_MODULE || 'playwright');
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const forceEnforce = process.argv.includes('--force-enforce');
const ROUTES = ['/', '/lab', '/probe', '/build', '/review', '/multi-fault', '/twin', '/studio', '/ac', '/teams', '/learn', '/tracks', '/for-the-larp', '/for-the-larp/voice-lab'];
// Buttons that only load local samples or run local engines (never image extraction / model calls).
const SAFE = /^(load |.*sample|guide me|solve|find fault|run review|fill demo|rank fault|loaded bridge|advanced bridge|next|review pasted|reveal solver|hint 1|3d$|iso$)/i;
const ZOD_PROBE = /^script-src blocked eval |'unsafe-eval' is not an allowed source/;
const UNSAFE = /extract|upload|explain|gemini|mentor|analy[sz]e image|record|microphone|talk|send|delete|reset/i;

const browser = await chromium.launch({ headless: true, ...(process.env.CSP_BROWSER_EXECUTABLE && { executablePath: process.env.CSP_BROWSER_EXECUTABLE }) });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'} ${e.sourceFile ? `at ${e.sourceFile}:${e.lineNumber}` : ''}`.trim()));
});
if (forceEnforce)
  await ctx.route(`${base}/**`, async (route) => {
    const res = await route.fetch();
    const headers = { ...res.headers() };
    const policy = process.env.CSP_OVERRIDE || headers['content-security-policy-report-only'] || headers['content-security-policy'];
    if (policy && (res.headers()['content-type'] ?? '').includes('text/html')) {
      headers['content-security-policy'] = policy;
      delete headers['content-security-policy-report-only'];
    }
    await route.fulfill({ response: res, headers });
  });

let total = 0;
for (const path of ROUTES) {
  const page = await ctx.newPage();
  const consoleCsp = [];
  page.on('console', (m) => /Content Security Policy|Content-Security-Policy/i.test(m.text()) && consoleCsp.push(m.text().slice(0, 200)));
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  const res = await page.goto(base + path, { waitUntil: 'networkidle', timeout: 45_000 });
  const csp = res.headers()['content-security-policy'] ? 'enforce' : res.headers()['content-security-policy-report-only'] ? 'report-only' : 'none';
  let clicked = 0;
  // Labels are read once up front: clicks re-render the page and stale element handles would hang.
  const labels = (await page.getByRole('button').allTextContents()).map((t) => t.trim()).filter((t) => SAFE.test(t) && !UNSAFE.test(t));
  for (const t of [...new Set(labels)].slice(0, 4)) {
    const b = page.getByRole('button', { name: t, exact: true }).first();
    if (!(await b.isVisible().catch(() => false)) || !(await b.isEnabled().catch(() => false))) continue;
    await b.click({ timeout: 5_000 }).catch(() => undefined);
    clicked++;
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(1_500); // WebGL / workers settle
  const events = await page.evaluate(() => window.__csp);
  const all = [...new Set([...events, ...consoleCsp])].filter((v) => !ZOD_PROBE.test(v));
  const probe = events.some((v) => ZOD_PROBE.test(v));
  total += all.length + errors.length;
  console.log(`${all.length || errors.length ? 'FAIL' : 'PASS'} ${path} status=${res.status()} csp=${csp} clicked=${clicked}${probe ? ' note=zod-eval-probe' : ''}${errors.length ? ` pageerrors=${errors.length}` : ''}`);
  for (const v of all) console.log(`   - ${v}`);
  for (const e of errors) console.log(`   ! ${e}`);
  await page.close();
}
await browser.close();
console.log(total ? `${total} CSP violation(s) / page error(s)` : 'CSP: no violations');
process.exit(total ? 1 : 0);
