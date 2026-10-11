// Requires a separately installed Playwright; no runtime dependency is added.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.GUIDED_PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.GUIDED_BROWSER_EXECUTABLE ? {executablePath:process.env.GUIDED_BROWSER_EXECUTABLE} : {})});
const base=process.env.BASE_URL || 'http://127.0.0.1:3000';
const output=process.env.CINEMATIC_UI_OUTPUT_DIR || 'work/cinematic-ui';
mkdirSync(output,{recursive:true});
const checks=[],errors=[],requests=[],observations=[];
const check=(label,condition)=>{assert.ok(condition,label);checks.push(label);};
const intersects=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
try {
 for(const reducedMotion of ['reduce','no-preference'])for(const width of [320,390,768,1440]) {
  const height=width<768?844:900;
  const page=await browser.newPage({viewport:{width,height},reducedMotion});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push({url:r.url(),body:r.postData()});});
  await page.route('**/api/extract',r=>r.abort());
  const suffix=`${width}px / ${reducedMotion}`;
  const noOverflow=async(route)=>check(`${route} has no horizontal overflow: ${suffix}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(base);await page.waitForSelector('.hero-instrument');await page.waitForTimeout(300);
  await noOverflow('Homepage');
  check(`Hero stays truthful: ${suffix}`,(await page.locator('.sample-tag').innerText())==='LOCAL PREVIEW');
  if(width===1440){const b=await page.locator('.hero-verify').boundingBox();check(`Verify button above desktop fold: ${suffix}`,b.y+b.height<=height);}
  const beforeSlider=requests.length;
  await page.getByRole('button',{name:'Set R2 to 1 kΩ'}).click();
  check(`Slider result is the actual local value: ${suffix}`,(await page.locator('.instrument-controls strong').first().innerText()).includes('0.455'));
  check(`Interaction makes no duplicate/model calls: ${suffix}`,requests.length===beforeSlider);
  await page.goto(`${base}/lab?sample=divider`);await page.waitForSelector('#review-title:visible');
  check(`Sample opens in unconfirmed Review: ${suffix}`,await page.locator('.guided-steps [aria-current="step"] strong').innerText()==='Review'&&await page.locator('.guided-frame:not([hidden])').getByRole('button',{name:'Next step'}).isDisabled());
  await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).check();
  const frame=()=>page.locator('.guided-frame:not([hidden])');
  await frame().getByRole('button',{name:'Next step'}).click();
  check(`Forward stage receives heading focus: ${suffix}`,await page.locator('#analyze-title').evaluate(e=>document.activeElement===e));
  await page.locator('#measured-vout').fill('0.45');await page.locator('.solve-button').click();
  await page.waitForSelector('.comparison-delta');await page.waitForTimeout(400);
  const expected=await page.locator('.comparison-value').first().boundingBox(),measured=await page.locator('.comparison-value.observed').boundingBox();
  const header=await page.locator('.site-header').boundingBox();
  check(`Both result numerals are visible without manual scroll: ${suffix}`,[expected,measured].every(b=>b.y>=header.height&&b.y+b.height<=height));
  check(`Signed difference and percent are grounded: ${suffix}`,(await page.locator('.comparison-delta').innerText()).includes('−2.050 V (−82%)'));
  check(`Verdict visible in first answer viewport: ${suffix}`,(await page.locator('.mismatch-card').boundingBox()).y<height);
  const comparisonHeight=await page.locator('.measurement-comparison').evaluate(e=>e.getBoundingClientRect().height);
  if(width===1440)check(`Compact desktop comparison: ${suffix}`,comparisonHeight<=160);
  const tiny=await page.locator('main').evaluate(e=>[...e.querySelectorAll('*')].filter(x=>x.getClientRects().length&&x.textContent.trim()&&parseFloat(getComputedStyle(x).fontSize)<11).map(x=>x.className));
  check(`Meaningful Lab text has an 11px CSS floor: ${suffix}`,tiny.length===0);
  if(width>=768){
   const contrast=await page.locator('.circuit-preview .node-reading').first().evaluate(e=>getComputedStyle(e).fill);
   check(`Light preview uses dark solved labels: ${suffix}`,contrast==='rgb(23, 59, 53)');
  }
  await noOverflow('Compare');
  if(reducedMotion==='reduce')check(`Reduced motion has no running Lab animations: ${suffix}`,await page.evaluate(()=>document.getAnimations().length===0));
  await page.getByRole('navigation',{name:'Investigation stages'}).getByRole('button',{name:/Review/}).click();
  check(`Back navigation keeps heading focus: ${suffix}`,await page.locator('#review-title').evaluate(e=>document.activeElement===e));
  check(`Back transition is directional: ${suffix}`,await page.locator('.guided-frames').getAttribute('data-direction')==='back');
  await page.goto(`${base}/probe`);await page.waitForSelector('.pg-schem');
  check(`Probe has one correct diagram: ${suffix}`,await page.locator('.pg-schem').count()===1&&await page.locator('.pg-panel .circuit-canvas').count()===0);
  for(const name of ['Resistor ladder','Voltage divider','Series-parallel']) {
   await page.getByRole('button',{name,exact:true}).click();
   const box=await page.locator('.pg-callout rect').boundingBox();
   const bounds=await page.locator('.pg-nlabel,.pg-part rect,.pg-part text').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};}));
   check(`Callout clears ${name} nodes and parts: ${suffix}`,bounds.every(b=>!intersects(box,b)));
  }
  await page.getByRole('button',{name:'Resistor ladder',exact:true}).click();
  await page.locator('#v0').fill('0');await page.getByRole('button',{name:'Guide me',exact:true}).click();await page.waitForSelector('.pg-probeCard');
  check(`Actual probe response highlights A: ${suffix}`,await page.locator('[data-node="A"]').getAttribute('data-highlighted')==='true');
  await page.getByRole('button',{name:'Hide guide',exact:true}).click();
  check(`Guide close returns focus: ${suffix}`,await page.getByRole('button',{name:'Show guide',exact:true}).evaluate(e=>document.activeElement===e));
  await noOverflow('Probe');
  await page.goto(`${base}/for-the-larp`);await page.waitForSelector('.ul-pipeSvg');
  await page.locator('.ul-pnode').filter({has:page.locator('text', {hasText:'MNA solver'})}).press('Enter');
  check(`Keyboard selects architecture stage: ${suffix}`,(await page.locator('#ul-pipe-detail h3').innerText()).includes('MNA solver'));
  check(`Selected architecture has a real incoming edge: ${suffix}`,await page.locator('.ul-edgeSelected').count()===1);
  // Locate by its accessible stamp label; values can be formatted differently.
  const stamp=page.getByRole('button',{name:/G\[VOUT, VOUT\].*1\/R1.*1\/R2/});
  check(`Matrix exposes resistor contributions: ${suffix}`,await stamp.count()===1);
  await stamp.focus();
  check(`Matrix stamp is keyboard inspectable: ${suffix}`,(await page.locator('.ul-stamp-note').innerText()).includes('1/R1 + 1/R2'));
  await noOverflow('Under the Hood');await page.waitForTimeout(300);
  const idleAnimations=await page.evaluate(()=>document.getAnimations().length);
  check(`No continuous architecture activity: ${suffix}`,idleAnimations===0);
  if(reducedMotion==='reduce')check(`Reduced motion has no architecture animation: ${suffix}`,idleAnimations===0);
  observations.push({width,reducedMotion,comparisonHeight,idleAnimations});
  await page.close();
 }
 check('No browser runtime errors',errors.length===0);
 check('No model endpoints called',requests.every(r=>/\/api\/(solve|probe)$/.test(new URL(r.url).pathname)));
 writeFileSync(`${output}/results.json`,JSON.stringify({passed:checks.length,checks,errors,requests:requests.length,observations,environment:'Real browser; measurement and probe requests use deterministic handlers; no model calls. Host rendering environment documented alongside results.'},null,2));
 console.log(`${checks.length} cinematic assertions passed; ${requests.length} solve/probe requests; no browser runtime errors.`);
}finally{await browser.close();}
