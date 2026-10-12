import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.GUIDED_PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.GUIDED_BROWSER_EXECUTABLE?{executablePath:process.env.GUIDED_BROWSER_EXECUTABLE}:{})});
const base=process.env.BASE_URL || 'http://127.0.0.1:3000';
const before=process.argv.includes('--before');
const output=process.env.LIVING_UI_OUTPUT_DIR || 'work/living-browser';
mkdirSync(output,{recursive:true});
const checks=[],errors=[],requests=[],observations=[];
const check=(name,pass)=>{assert.ok(pass,name);checks.push(name);};
let page;
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
try {
 for(const motion of ['reduce','no-preference'])for(const width of (process.env.LIVING_UI_WIDTH ? [Number(process.env.LIVING_UI_WIDTH)] : [320,390,768,1440])) {
  const height=width<768?844:900, tag=`${width}/${motion}`;
  page=await browser.newPage({viewport:{width,height},reducedMotion:motion});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push({url:r.url(),body:r.postData()});});
  await page.route('**/api/extract',r=>r.abort());await page.route('**/api/explain',r=>r.abort());
  const frame=()=>page.locator('.guided-frame:not([hidden])');
  const noOverflow=async(scene)=>check(`${scene} fits ${tag}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const shot=async(scene)=>{if(width===390||width===1440){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`${output}/${scene}-${width}-${motion}.png`});}};
  await page.goto(base);await page.waitForSelector('.hero-instrument');await page.waitForTimeout(750);
  await noOverflow('Home');await shot('home');
  if(!before){
   check(`Main CTA opens beginner Review ${tag}`,await page.getByRole('link',{name:'Try Ohmni',exact:true}).getAttribute('href')==='/lab?sample=divider');
   check(`Upload and advanced paths remain visible ${tag}`,await page.getByRole('link',{name:'Upload your schematic →',exact:true}).isVisible()&&await page.getByRole('link',{name:'Explore the advanced bridge →',exact:true}).isVisible());
   const words=(await page.locator('.hero-copy > p').innerText()).split(/\s+/).length;
   check(`Hero supporting copy stays short ${tag}`,words>=20&&words<=30);
   check(`Hero verification requires review ${tag}`,await page.locator('.hero-verify').isDisabled());
  }
  const n=requests.length;
  await page.getByRole('button',{name:'Set R2 to 1 kΩ'}).click();
  check(`Local interaction is real and makes no network call ${tag}`,requests.length===n&&(await page.locator('.instrument-controls strong').first().innerText()).includes('0.455'));
  const confirmAndCompare=async(kind)=>{await page.goto(`${base}/lab?sample=${kind}`);await page.waitForSelector('#review-title:visible');check(`Unconfirmed ${kind} is gated ${tag}`,await frame().getByRole('button',{name:'Next step'}).isDisabled());await page.getByRole('checkbox',{name:'I verified values, terminals and ground'}).check();await frame().getByRole('button',{name:'Next step'}).click();};
  await confirmAndCompare('divider');await page.locator('#measured-vout').fill('0.45');await page.locator('.solve-button').click();await page.waitForSelector('.comparison-delta');await page.waitForTimeout(550);
  check(`Basic reading moment stays correct ${tag}`,(await page.locator('.comparison-value').first().innerText()).includes('2.500')&&(await page.locator('.comparison-delta').innerText()).includes('−2.050 V (−82%)'));
  await noOverflow('Basic comparison');await shot('basic-comparison');
  if(before){
   await page.goto(`${base}/lab`);await page.waitForSelector('#capture-title:visible');
   check(`Baseline Lab has no advanced sample ${tag}`,await page.getByRole('button',{name:'Advanced bridge',exact:true}).count()===0);
   await shot('advanced-lab-entry-before');
   await page.goto(`${base}/probe`);await page.getByRole('button',{name:'Loaded bridge',exact:true}).click();await page.waitForSelector('#v0');await page.locator('#v0').fill('0');await page.getByRole('button',{name:'Guide me',exact:true}).click();await page.waitForSelector('.pg-probeCard');
   await page.locator('.pg-schem').scrollIntoViewIfNeeded();await shot('probe');await noOverflow('Probe');
  }else{
   await confirmAndCompare('advanced');
   check(`Advanced requires server MNA ${tag}`,await page.locator('.backend-switch input').isChecked()&&await page.locator('.backend-switch input').isDisabled());
   await page.locator('#measured-vout').fill('0');const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/solve')&&r.request().method()==='POST'),page.locator('.solve-button').click()]);
   check(`Advanced solver succeeds ${tag}`,response.ok());const healthy=(await response.json()).result;const graph=response.request().postDataJSON().graph;
   check(`Bridge node voltages are independently consistent ${tag}`,Math.abs(healthy.voltages.A-7.342)<.005&&Math.abs(healthy.voltages.B-4.087)<.005&&Math.abs(healthy.voltages.C-2.609)<.005);
   await page.waitForSelector('.comparison-delta');await page.waitForTimeout(650);
   const svg=page.locator('.evidence-schematic svg');
   check(`All eight components and five nodes are distinct ${tag}`,await svg.locator('[data-component]').count()===8&&await svg.locator('[data-node]').count()===5);
   for(const c of graph.components){const part=svg.locator(`[data-component="${c.id}"]`);check(`Rendered ${c.id} preserves terminals ${tag}`,await part.getAttribute('data-positive-node')===c.positiveNode&&await part.getAttribute('data-negative-node')===c.negativeNode);}
   await page.evaluate(()=>document.fonts.ready);
   const boxes=await svg.locator('text').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect();return {text:e.textContent,x:b.x,y:b.y,width:b.width,height:b.height};}));
   const collisions=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)if(overlap(boxes[i],boxes[j]))collisions.push([boxes[i].text,boxes[j].text]);
   check(`Advanced diagram labels never overlap ${tag}: ${JSON.stringify(collisions)}`,collisions.length===0);
   const expected=await page.locator('.comparison-value').first().boundingBox(),measured=await page.locator('.comparison-value.observed').boundingBox();
   check(`Advanced values visible after solve ${tag}`,[expected,measured].every(b=>b.y>=60&&b.y+b.height<=height));
   check(`Advanced measurement node is highlighted ${tag}`,await svg.locator('[data-node="C"]').getAttribute('data-highlighted')==='true');
   await noOverflow('Advanced comparison');await shot('advanced-comparison');
   // Independent test scenario: solve the same confirmed graph with R6 removed.
   const faultResponse=await page.request.post(`${base}/api/solve`,{data:{graph:{...graph,components:graph.components.filter(c=>c.id!=='R6')},userConfirmed:true}});
   check(`Fault scenario uses the real server ${tag}`,faultResponse.ok());const fault=(await faultResponse.json()).result;
   check(`Open R6 grounds C and changes coupled nodes ${tag}`,fault.voltages.C===0&&Math.abs(fault.voltages.A-7.533)<.005&&Math.abs(fault.voltages.B-5.220)<.005);
   await page.getByRole('navigation',{name:'Investigation stages'}).getByRole('button',{name:/Review/}).click();check(`Advanced values remain open for review ${tag}`,await page.locator('.review-values').getAttribute('open')!==null);await page.getByRole('spinbutton',{name:'R6 value in ohms'}).fill('700');
   check(`Editing bridge clears result and confirmation ${tag}`,await page.locator('.voltage-result').count()===0&&await page.getByRole('navigation',{name:'Investigation stages'}).getByRole('button',{name:/Compare/}).isDisabled());
   await page.goto(`${base}/probe`);await page.getByRole('button',{name:'Advanced bridge',exact:true}).click();await page.locator('#v0').fill('0');
   check(`Advanced probe requires explicit graph review ${tag}`,await page.getByRole('button',{name:'Guide me',exact:true}).isDisabled());
   await page.getByRole('checkbox',{name:'I reviewed this prepared graph and its connections.'}).check();
   let [probeResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/probe')),page.getByRole('button',{name:'Guide me',exact:true}).click()]);let step=(await probeResponse.json()).result;
   for(let i=0;i<4&&step.next;i++){
    const target=page.locator(`.advanced-node[data-node="${step.next.node}"]`);await page.waitForTimeout(450);
    check(`Actual recommended ${step.next.node} is highlighted ${tag}`,await target.getAttribute('data-highlighted')==='true');
    if(i===0){await page.locator('.advanced-instrument').scrollIntoViewIfNeeded();await shot('probe');}
    await page.locator('#v1').fill(String(fault.voltages[step.next.node]));[probeResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/probe')),page.getByRole('button',{name:'Submit reading',exact:true}).click()]);step=(await probeResponse.json()).result;
   }
   check(`Real history narrows to R6 open ${tag}`,step.hypotheses[0].id==='R6:open'&&step.hypotheses[0].probability>.9);
   check(`Conclusion retains physical verification ${tag}`,(await page.locator('.pg-safety').first().innerText()).includes('hypotheses'));
   check(`Tutor remains progressively disclosed ${tag}`,await page.locator('.pg-tutor').getAttribute('open')===null);
   await noOverflow('Advanced probe');await page.waitForTimeout(700);
   if(motion==='reduce')check(`Reduced motion has no running animations ${tag}`,await page.evaluate(()=>document.getAnimations().length===0));
   observations.push({width,motion,healthy:healthy.voltages,faulted:fault.voltages,topHypothesis:step.hypotheses[0].id,probability:step.hypotheses[0].probability});
  }
  await page.close();console.log(`Checked ${tag}`);
 }
 check('No browser runtime errors',errors.length===0);
 check('No model endpoints requested',requests.every(r=>/\/api\/(solve|probe)$/.test(new URL(r.url).pathname)));
 writeFileSync(`${output}/results.json`,JSON.stringify({phase:before?'before':'after',passed:checks.length,checks,errors,requests:requests.length,observations,environment:process.env.LIVING_UI_ENVIRONMENT || 'Target BASE_URL application; production/harness environment must be identified by caller.'},null,2));
 console.log(`${checks.length} Living Schematic checks pass; no runtime errors or model calls.`);
}catch(e){console.error(e);if(page&&!page.isClosed()){await page.screenshot({path:`${output}/failure.png`,fullPage:true});writeFileSync(`${output}/failure.json`,JSON.stringify({error:String(e),checks,errors,body:(await page.locator('body').innerText()).slice(-9000)},null,2));}throw e;}
finally{await browser.close();}
