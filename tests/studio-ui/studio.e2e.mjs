// Playwright e2e for /studio. Run: E2E_DIR=%TEMP%\ohmni-e2e BASE=http://localhost:3107 node tests/studio-ui/studio.e2e.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.join(process.env.E2E_DIR, 'x.js'));
const { chromium } = require('playwright');
const BASE = process.env.BASE ?? 'http://localhost:3107';
const OUT = process.env.OUT ?? 'docs/ui-review/studio';
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok  ' + m); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = (page) => {
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
};

async function flow(vw, vh, tag) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + '/studio');
  await page.waitForSelector('[data-testid="diff-status"]');
  ok((await page.textContent('[data-testid="diff-status"]')).includes('1 difference'), `${tag}: mistake preset shows diff`);
  ok((await page.textContent('[data-testid="diff-list"]')).includes('R2'), `${tag}: diff names R2`);
  // WebGL canvas renders non-blank pixels
  await page.waitForSelector('canvas', { timeout: 20000 });
  await page.waitForTimeout(1500);
  const px = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    const t = document.createElement('canvas'); t.width = 64; t.height = 64;
    const g = t.getContext('2d'); g.drawImage(c, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data; const seen = new Set();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return seen.size;
  });
  ok(px > 6, `${tag}: WebGL canvas has varied pixels (${px} colours)`);
  await page.screenshot({ path: `${OUT}/studio-3d-mistake-${tag}.png` });
  // 3D click: hole pick via projected coordinates
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const pos = await page.evaluate(() => window.__studio3d.holeScreen('b5'));
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.click(box.x + pos.x, box.y + pos.y);
  ok((await page.textContent('[data-testid="inspector"]')).includes('Hole b5'), `${tag}: 3D hole click selects net`);
  // 2D fallback: move jumper end
  await page.click('[data-testid="mode-2d"]');
  await page.click('[data-testid="jumper-J2"]');
  await page.click('[data-testid="jumper-J2-b"]');
  ok(await page.isVisible('[data-testid="tool-banner"]'), `${tag}: move tool armed`);
  await page.click('[data-testid="hole-c14"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="diff-status"]')?.textContent?.includes('matches'));
  ok(true, `${tag}: diff identical after moving J2 to c14`);
  await page.check('[data-testid="confirm"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="v-built"]')?.textContent?.includes('2.500'));
  ok((await page.textContent('[data-testid="v-built"]')).includes('2.500 V'), `${tag}: /api/solve VOUT 2.500 V`);
  // edit invalidates
  await page.click('[data-testid="jumper-J2"]');
  await page.click('[data-testid="move-b"]');
  await page.click('[data-testid="hole-c15"]');
  ok(!(await page.isChecked('[data-testid="confirm"]')), `${tag}: edit clears confirmation`);
  ok((await page.textContent('[data-testid="v-built"]')).includes('—'), `${tag}: edit clears stale solve`);
  await page.screenshot({ path: `${OUT}/studio-2d-${tag}.png` });
  await page.click('[data-testid="load-correct"]');
  await page.click('[data-testid="mode-3d"]');
  await page.waitForTimeout(1200);
  await page.click('[data-testid="view-top"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/studio-3d-correct-top-${tag}.png` });
  await ctx.close();
}

await flow(1440, 900, '1440');
await flow(390, 844, '390');

// WebGL disabled -> 2D fallback
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/.test(t) ? null : orig.call(this, t, ...a); };
  });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + '/studio');
  await page.waitForSelector('[data-testid="board2d"]');
  ok(!(await page.$('canvas')), 'no WebGL: no canvas, 2D board shown');
  await page.click('[data-testid="jumper-J2"]');
  await page.click('[data-testid="move-b"]');
  await page.click('[data-testid="hole-c14"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="diff-status"]')?.textContent?.includes('matches'));
  ok(true, 'no WebGL: fix works');
  // keyboard: focus a hole, arrow, Enter
  await page.focus('[data-testid="hole-a1"]');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  ok((await page.textContent('[data-testid="inspector"]')).includes('Hole a2'), 'keyboard nav selects a2');
  await page.screenshot({ path: `${OUT}/studio-nowebgl-1440.png` });
  await ctx.close();
}

// reduced motion
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + '/studio');
  await page.click('[data-testid="mode-2d"]');
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.st-pulse')).animationName);
  ok(anim === 'none', 'reduced motion: pulse animation disabled');
  await ctx.close();
}

await browser.close();
const real = errors.filter((e) => !/favicon|GPU stall|swiftshader|WebGL: INVALID|GL Driver/i.test(e));
console.log('console errors:', real);
ok(real.length === 0, 'no console errors');
