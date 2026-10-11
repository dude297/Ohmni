import Link from "next/link";
import { ArrowRight, CircuitBoard, Network, ScanLine, Layers, Cpu, Wrench } from "lucide-react";

const demos = [
  { n:"01", badge:"WORKING SAMPLE", icon: CircuitBoard, title:"Voltage divider",
    text:"5 V, two 10 kΩ resistors. Compare the expected 2.50 V with a measured 0.45 V, then inspect a testable fault hypothesis.",
    note:"Uses local backend MNA, not a vision-model call", href:"/lab?sample=divider", cta:"Open divider" },
  { n:"02", badge:"WORKING SAMPLE", icon: Network, title:"Series and parallel",
    text:"A 12 V source, 100 Ω series resistor and 200 Ω / 300 Ω parallel branches. Predict and inspect the 6.545 V midpoint.",
    note:"Uses local backend MNA, not a vision-model call", href:"/lab?sample=network", cta:"Open network" },
  { n:"03", badge:"LIVE INPUT", icon: ScanLine, title:"Ambiguous junction",
    text:"Upload your own schematic with a crossing or unclear junction. Resolve uncertain connections through human review.",
    note:"Live model outcome depends on real API access; not pre-scripted", href:"/lab?upload=1", cta:"Upload schematic" },
] as const;
const stages = [
  {n:"01",badge:"AVAILABLE · LIMITED DC",icon:CircuitBoard,title:"Understand",text:"Readable schematics → editable circuit graphs → confirmed numerical analysis and fault hypotheses.",uses:"EE labs · Makers · Hardware learning"},
  {n:"02",badge:"PLANNED",icon:Layers,title:"See denser",text:"Junction highlighting, image crops, connected-region reconciliation, and step-by-step user clarification.",uses:"Dense schematics · Lab sheets · QA"},
  {n:"03",badge:"RESEARCH",icon:Cpu,title:"Simulate more",text:"Validate new solver paths for nonlinear parts, AC, transient analysis and SPICE-backed cross-checks.",uses:"Embedded · Analog · Power systems"},
  {n:"04",badge:"EXPLORATION",icon:Wrench,title:"Connect workflows",text:"Explore breadboard/PCB/EDA imports, lab reports, shared diagnoses and test equipment integrations.",uses:"Hardware teams · Field repair · Manufacturing"},
] as const;
export function LaunchShowcase() {
 return <>
  <section id="examples" className="showcase-section" aria-labelledby="examples-heading">
    <div className="showcase-heading"><div><span className="eyebrow">SCHEMATIC-FIRST</span><h2 id="examples-heading">Start clear. Then challenge the reasoning.</h2></div><p>Three paths through the product. Working electrical samples stay distinct from live AI image analysis.</p></div>
    <div className="showcase-grid">
      {demos.map(({n,badge,icon:Icon,title,text,note,href,cta})=><article className="showcase-card" key={n}>
        <div className="showcase-card-top"><span>{n} / {badge}</span><Icon size={25} aria-hidden="true"/></div>
        <h3>{title}</h3><p>{text}</p>
        <div className="showcase-bottom"><span>{note}</span><Link href={href} className="showcase-cta">{cta} <ArrowRight size={15} aria-hidden="true"/></Link></div>
      </article>)}
    </div>
    <p className="showcase-disclaimer">Today: readable resistor/DC-voltage-source schematics only. Dense diagrams, arbitrary breadboards and PCB analysis are not yet supported. No simulated model confidence or pre-recorded routing.</p>
  </section>
  <section id="roadmap" className="roadmap-section" aria-labelledby="product-heading">
    <div className="showcase-heading"><div><span className="eyebrow">THE PLATFORM VISION</span><h2 id="product-heading">One trusted circuit graph. Many future applications.</h2></div><p>We expand by adding validated input adapters and solver engines, never by assuming a model understands every wire. Stages after the first are exploratory, not released features or delivery promises.</p></div>
    <ol className="roadmap-grid">{stages.map(({n,badge,icon:Icon,title,text,uses})=><li className="roadmap-step" key={n}>
      <div className="roadmap-head"><span>{n}</span><span className={n==="01"?"roadmap-available":"roadmap-future"}>{badge}</span></div>
      <Icon size={25} aria-hidden="true"/>
      <h3>{title}</h3><p>{text}</p><span className="roadmap-usecase">{uses}</span>
    </li>)}</ol>
    <p className="roadmap-summary">Shared foundation: evidence-backed extraction → human verification → deterministic electrical analysis → next useful measurement.</p>
  </section>
 </>;
}
