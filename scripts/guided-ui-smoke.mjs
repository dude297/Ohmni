const {chromium} = await import(process.env.GUIDED_PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch({headless:true,...(process.env.GUIDED_BROWSER_EXECUTABLE ? {executablePath:process.env.GUIDED_BROWSER_EXECUTABLE} : {})});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[],checks=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(m.text());});
page.on('request',r=>{if(r.url().includes('/api/'))requests.push({url:r.url(),body:r.postData()});});
const base=process.env.BASE_URL || 'http://127.0.0.1:3000';
const output=process.env.GUIDED_UI_OUTPUT_DIR || 'work/guided-ui';
const frame=()=>page.locator('.guided-frame:not([hidden])');
const stages=()=>page.getByRole('navigation',{name:'Investigation stages'});
const check=(label,value)=>{assert.ok(value,label);checks.push(label);};
const next=()=>frame().getByRole('button',{name:'Next step'}).click();
async function stage(name){await page.waitForFunction(n=>document.querySelector('.guided-steps [aria-current="step"] strong')?.textContent===n,name);check(`Only ${name} frame displayed`,await page.locator('.guided-frame:visible').count()===1);}
async function noOverflow(label){check(label,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
async function readySample(kind){await page.goto(`${base}/lab?sample=${kind}`);await stage('Capture');await next();await stage('Review');await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).check();await next();await stage('Compare');}
async function solve(reading){if(reading!==undefined)await page.locator('#measured-vout').fill(reading);await frame().locator('.solve-button').click();await page.waitForSelector('.voltage-result');}
mkdirSync(output,{recursive:true});
try {
  await page.goto(base);await page.waitForSelector('.site-header');
  check('No scroll progress indicator',await page.locator('.reading-progress').count()===0);
  check('Header uses sticky positioning',await page.locator('.site-header').evaluate(e=>getComputedStyle(e).position)==='sticky');
  check('Audience section follows How it works and precedes roadmap',await page.evaluate(()=>!!(document.querySelector('#how-it-works').compareDocumentPosition(document.querySelector('#use-cases'))&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(document.querySelector('#use-cases').compareDocumentPosition(document.querySelector('#roadmap'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  check('Two current and two future audience labels',await page.getByText('Current limited use case',{exact:true}).count()===2&&await page.getByText('Future applications',{exact:true}).count()===2);
  await page.evaluate(()=>scrollTo(0,900));
  check('Header remains at viewport top after scrolling',Math.abs((await page.locator('.site-header').boundingBox()).y)<1);
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});await noOverflow(`Homepage has no overflow at ${width}px`);check(`All nav links visible at ${width}px`,await page.locator('header a[href="#how-it-works"]').isVisible()&&await page.locator('header a[href="#use-cases"]').isVisible()&&await page.locator('header a[href="/lab"]').isVisible());}
  await page.evaluate(()=>document.querySelector('#use-cases').scrollIntoView());await page.screenshot({path:`${output}/audiences-desktop.png`});
  await page.goto(`${base}/lab`);await stage('Capture');
  check('Idle banner removed',await page.locator('.session-banner').count()===0&&!(await page.locator('body').innerText()).includes('READY WHEN YOU ARE'));
  check('Idle status omitted',await page.locator('.investigation-status').count()===0);
  check('Empty capture cannot proceed',await frame().getByRole('button',{name:'Next step'}).isDisabled());
  for(const name of ['Review','Compare','Investigate'])check(`Empty ${name} stage gated`,await stages().getByRole('button',{name:new RegExp(name)}).isDisabled());
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/capture-desktop.png`,fullPage:true});
  await frame().getByRole('button',{name:'Try probe ladder'}).click();await next();await stage('Review');
  check('Next heading receives keyboard focus',await page.locator('#review-title').evaluate(e=>document.activeElement===e));
  check('Stage navigation is visible after advancing', (await stages().boundingBox()).y >= (await page.locator('.site-header').boundingBox()).height);
  check('Review blocks Next before confirmation',await frame().getByRole('button',{name:'Next step'}).isDisabled());
  check('Desktop preview displayed',await page.getByRole('complementary',{name:'Circuit preview'}).isVisible());
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/review-desktop.png`,fullPage:true});
  await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).check();
  check('Status shows actual confirmation',await page.locator('.investigation-status').innerText()==='Circuit confirmed');
  await next();await stage('Compare');
  check('Investigation gated before solver result',await stages().getByRole('button',{name:/Investigate/}).isDisabled());
  await solve('0');check('Actual ladder solver produces 1.667 V',(await page.locator('.voltage-result').innerText()).includes('1.667'));
  check('Solver request includes human confirmation',JSON.parse(requests.find(r=>r.url.endsWith('/api/solve')).body).userConfirmed===true);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/compare-desktop.png`,fullPage:true});
  await next();await stage('Investigate');
  await page.getByRole('button',{name:'Guide me',exact:true}).click();await page.waitForSelector('.next-probe');
  check('Actual probe chooses A',await page.locator('.next-probe h4').innerText()==='Measure A');
  check('Sidebar highlights suggested probe node',await page.locator('.circuit-preview .suggested-ring').count()>0);
  await page.locator('#probe-reading').fill('5');await page.getByRole('button',{name:'Update investigation'}).click();await page.waitForSelector('.probe-conclusion');
  check('Second real reading narrows modeled fault', (await page.locator('.probe-conclusion').innerText()).includes('R2 open'));
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/investigate-desktop.png`,fullPage:true});
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download investigation evidence'}).click();check('Evidence download still works',(await download).suggestedFilename()==='ohmni-investigation.json');
  await frame().getByRole('button',{name:'Back',exact:true}).click();await stage('Compare');
  check('Back retains solver result',await page.locator('.voltage-result').isVisible());
  await next();await stage('Investigate');check('Stage roundtrip retains probe history',await page.getByRole('button',{name:'Remove reading A 5 volts'}).isVisible());
  await page.getByRole('button',{name:'Remove reading A 5 volts'}).click();await page.waitForSelector('.next-probe');check('Removing reading recalculates next probe',(await page.locator('.next-probe h4').innerText())==='Measure A');
  await frame().getByRole('button',{name:'Review circuit',exact:true}).click();await stage('Review');
  await page.getByRole('spinbutton',{name:'R2 value in ohms'}).fill('1000');
  check('Circuit edit clears confirmation',!await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).isChecked());
  check('Circuit edit removes result and probe state',await page.locator('.voltage-result').count()===0&&await page.locator('.probe-guide').count()===0);
  check('Circuit edit gates later stages',await stages().getByRole('button',{name:/Compare/}).isDisabled()&&await stages().getByRole('button',{name:/Investigate/}).isDisabled());
  await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).check();await next();await solve('0');check('Reconfirm and solve edited ladder computes 2.381 V',(await page.locator('.voltage-result').innerText()).includes('2.381'));
  await readySample('divider');await solve();check('Divider backend computes 2.500 V',(await page.locator('.voltage-result').innerText()).includes('2.500'));await next();await stage('Investigate');check('No-reading stage explains how to add evidence',await page.getByText('Add a reading to investigate a discrepancy.',{exact:true}).isVisible());
  await stages().getByRole('button',{name:/Compare/}).click();await solve('2.5');await next();check('Matched reading uses honest notice',await page.getByText('Your reading agrees with the prediction.',{exact:true}).isVisible()&&await page.locator('.probe-guide').count()===0);
  await stages().getByRole('button',{name:/Review/}).click();await page.getByRole('spinbutton',{name:'R2 value in ohms'}).fill('1000');await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).check();await next();await solve('0.45');check('Edited divider backend computes 0.455 V',(await page.locator('.voltage-result').innerText()).includes('0.455'));
  await readySample('network');await solve('4.8');check('Network backend computes 6.545 V',(await page.locator('.voltage-result').innerText()).includes('6.545'));
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:900});await readySample('ladder');await stages().getByRole('button',{name:/Capture/}).click();await stage('Capture');await noOverflow(`Capture no overflow ${width}`);await next();await stage('Review');await noOverflow(`Review no overflow ${width}`);await next();await stage('Compare');await solve('0');await noOverflow(`Compare no overflow ${width}`);await next();await stage('Investigate');await page.getByRole('button',{name:'Guide me',exact:true}).click();await page.waitForSelector('.next-probe');await noOverflow(`Investigate no overflow ${width}`);
    check(`Sidebar visibility appropriate at ${width}`,width<=760?!await page.locator('.circuit-preview').isVisible():await page.locator('.circuit-preview').isVisible());
    if(width===390)await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/investigate-mobile.png`,fullPage:true});
  }
  await page.goto(`${base}/lab`);await page.waitForSelector('.guided-frame');
  await page.locator('.json-editor summary').click();await page.locator('#graph-json').fill('{broken');await page.getByRole('button',{name:'Load graph for review'}).click();check('Malformed graph shows visible recovery alert',await page.getByRole('alert').isVisible()&&await frame().getByRole('button',{name:'Next step'}).isDisabled());
  await page.route('**/api/extract',r=>r.fulfill({status:503,json:{error:{code:'PROVIDER_UNAVAILABLE',message:'Fixture: extraction unavailable'}}}));
  await page.locator('input[type="file"]').setInputFiles('public/samples/clear-divider.png');await page.waitForFunction(()=>document.querySelector('.investigation-status')?.textContent==='Review needs attention');check('Fixture: failed extraction retains uploaded source',await page.locator('.image-preview img').isVisible()&&await page.getByRole('alert').isVisible());
  check('Unavailable extraction keeps Compare gated',await stages().getByRole('button',{name:/Compare/}).isDisabled());
  await page.getByRole('button',{name:'Build a manual divider'}).click();await next();await stage('Review');check('Manual fallback recovers without stale error',await page.locator('.guided-error').count()===0);
  // Explicitly mocked extraction, used only to exercise ambiguity gates and source review.
  const graph={schemaVersion:1,groundNode:'GND',measureNode:'VOUT',components:[{id:'V1',kind:'dc_voltage',value:5,positiveNode:'VIN',negativeNode:'GND'},{id:'R1',kind:'resistor',value:10000,positiveNode:'VIN',negativeNode:'VOUT'},{id:'R2',kind:'resistor',value:10000,positiveNode:'VOUT',negativeNode:'GND'}]};
  await page.unroute('**/api/extract');
  await page.goto(`${base}/lab`);await page.route('**/api/extract',r=>r.fulfill({json:{extraction:{graph,inputKind:'schematic',requiresHumanReview:true,warnings:['Fixture uncertainty'],unresolvedConnections:['Check crossing at VOUT']},route:'ask_user',trace:[]}}));
  await page.locator('input[type="file"]').setInputFiles('public/samples/clear-divider.png');await stage('Review');
  check('Fixture: ambiguity disables confirmation',await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).isDisabled());
  await page.locator('.review-source summary').click();check('Uploaded source can be inspected during review',await page.locator('.review-source img').isVisible());
  for(const box of await page.locator('.review-warnings input').all())await box.check();check('Fixture: resolving issues enables confirmation',await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).isEnabled());
  await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).check();await next();await solve('0.45');await stages().getByRole('button',{name:/Review/}).click();await page.getByRole('spinbutton',{name:'R2 value in ohms'}).fill('1000');check('Fixture: edit clears ambiguity acknowledgements',await page.locator('.review-warnings input:checked').count()===0&&await stages().getByRole('button',{name:/Compare/}).isDisabled());
  await page.unroute('**/api/extract');
  await readySample('divider');
  for(const code of [429,413,503]){await page.route('**/api/solve',r=>r.fulfill({status:code,json:{error:{code:'QA_ERROR',message:`Fixture HTTP ${code}`}}}));await frame().locator('.solve-button').click();await page.waitForSelector('.guided-error');check(`Fixture ${code}: visible error keeps investigation gated`,await stages().getByRole('button',{name:/Investigate/}).isDisabled()&&await page.getByRole('alert').isVisible());await page.unroute('**/api/solve');}
  await solve('0.45');check('Retry with genuine endpoint recovers',await page.locator('.voltage-result').isVisible()&&await page.locator('.guided-error').count()===0);
  check('No browser runtime errors',errors.length===0);
  writeFileSync(`${output}/results.json`,JSON.stringify({passed:checks.length,checks,errors,realRequests:requests.length,environment:'Browser smoke against BASE_URL; genuine solve/probe; extraction and HTTP error fixtures explicitly labeled'},null,2));
  console.log(`${checks.length} browser assertions passed; ${requests.length} API requests; no browser runtime errors.`);
}catch(e){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${output}/failure.png`,fullPage:true});console.error('BODY', (await page.locator('body').innerText()).slice(-6000));throw e;}
finally{await browser.close();}

