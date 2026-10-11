"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw } from "lucide-react";
import { sampleGraph, solveSample } from "../../components/ohmni/api";
import s from "../tracks/tracks.module.css";

const choices = [
  { resistance: 1000, label: "1 kΩ" },
  { resistance: 10000, label: "10 kΩ" },
  { resistance: 22000, label: "22 kΩ" },
] as const;
type Guess = "lower" | "same" | "higher";
const names: Record<Guess,string> = { lower: "Decrease", same: "Stay the same", higher: "Increase" };

export function LearnClient() {
  const [r2,setR2] = useState<number>(1000);
  const [guess,setGuess] = useState<Guess|null>(null);
  const graph = useMemo(() => ({
    ...sampleGraph("divider"),
    components: sampleGraph("divider").components.map(c => c.id === "R2" ? { ...c, value:r2 } : { ...c }),
  }), [r2]);
  const solution = useMemo(() => solveSample(graph), [graph]);
  const voltage = solution.voltages.VOUT;
  const current = solution.currents.R1 * 1000;
  const correct: Guess = voltage < 2.5 - 1e-8 ? "lower" : voltage > 2.5 + 1e-8 ? "higher" : "same";
  const shown = guess !== null;
  const success = guess === correct;
  const selected = choices.find(x=>x.resistance===r2)!;

  return <div className={s.shell}>
    <header className={s.top}>
      <Link href="/" className={s.logo}>ohmni<span>.</span></Link>
      <nav className={s.topnav} aria-label="Learn navigation">
        <Link href="/tracks"><ArrowLeft size={14} aria-hidden="true"/> Workspaces</Link>
        <Link href="/lab?sample=divider">Lab <ArrowRight size={14} aria-hidden="true"/></Link>
      </nav>
    </header>
    <main className={s.wrap}>
      <div className={s.mast}>
        <div><div className={s.kicker}>Ohmni Learn / 01</div><h1>Change one part.<br/>Understand the circuit.</h1><p>Predict a node voltage before revealing the actual calculation. Learn by testing your own ideas.</p></div>
        <span className={s.pill}>Local interactive lesson · DC only</span>
      </div>
      <div className={s.columns}>
        <section className={s.panelDark} aria-labelledby="learn-circuit">
          <div className={s.between}><h2 className={s.panelTitle} id="learn-circuit">01 / Circuit instrument</h2><span className={s.liveTag}>5 V SOURCE</span></div>
          <svg className={s.diagram} viewBox="0 0 440 330" role="img" aria-label={"Five volt voltage divider. R1 is 10 kilohms, R2 is "+selected.label+". The junction VOUT is the measured node."}>
            <path d="M90 135V52H257V95 M257 143V174 M257 174V207 M257 254V295H90V190" />
            <circle cx="90" cy="160" r="30" fill="none" stroke="#a5c0b7" strokeWidth="2.5"/>
            <path d="M82 149h16m-8-8v16m-8 15h16" />
            <rect x="247" y="95" width="20" height="48" rx="3" />
            <rect x="247" y="207" width="20" height="47" rx="3" />
            <circle cx="257" cy="174" r="5" />
            <path d="M257 295v12m-17 0h34m-28 7h22m-16 7h10"/>
            <path d="M257 174h76" stroke="#f2b45a" strokeWidth="2.5"/>
            <text x="34" y="161">V1</text><text x="32" y="183">5 V</text>
            <text x="286" y="111">R1</text><text x="286" y="129">10 kΩ</text>
            <text x="286" y="222">R2</text><text x="286" y="243">{selected.label}</text>
            <text x="340" y="178" fill="#f2b45a">VOUT</text>
            <text x="278" y="48">VIN</text><text x="278" y="304">GND</text>
          </svg>
          <div className={s.hrDark}/>
          <div className={s.between}>
            <div><span className={s.metricLabel}>SOLVER-PREDICTED VOUT</span><div className={s.value}><span className={s.valueAccent}>{shown ? voltage.toFixed(3) : "?.???"}</span><span style={{fontSize:19,marginLeft:8}}>V</span></div></div>
            <span className={s.darkSmall}>{shown ? current.toFixed(3)+" mA through R1" : "Predict before revealing"}</span>
          </div>
        </section>
        <section className={s.panel} aria-labelledby="learn-task">
          <h2 className={s.panelTitleLight} id="learn-task">02 / Make a prediction</h2>
          <label className={s.controlLabel}>Choose the lower resistor (R2)</label>
          <div className={s.choices} role="group" aria-label="Choose R2">
            {choices.map(c=><button key={c.resistance} type="button" className={s.option+" "+(r2===c.resistance?s.optionActive:"")} aria-pressed={r2===c.resistance} onClick={()=>{setR2(c.resistance);setGuess(null)}}>{c.label}</button>)}
          </div>
          <div className={s.hr}/>
          <p className={s.lessonQuestion}>Relative to R2 = 10 kΩ, will VOUT change?</p>
          <div className={s.choices} role="group" aria-label="Predict voltage">
            {(["lower","same","higher"] as Guess[]).map(g=><button key={g} type="button" className={s.option+" "+(guess===g?s.optionActive:"")} aria-pressed={guess===g} onClick={()=>setGuess(g)}>{names[g]}</button>)}
          </div>
          {shown && <div className={s.feedback+" "+(success?s.feedbackGood:"")} role="status">
            <strong>{success?"That's correct.":"Good experiment. Here's the result."}</strong>
            <div>R2 is {selected.label}. The deterministic divider calculation gives <b>{voltage.toFixed(3)} V</b> at VOUT, so the voltage should {names[correct].toLowerCase()} relative to 2.500 V.</div>
            <div style={{marginTop:8}}>VOUT = 5 × R2 / (10,000 + R2) volts. This is a simulated circuit prediction, not a measurement.</div>
          </div>}
          <div className={s.hr}/>
          <div className={s.row}>
            <button type="button" className={s.ctaAlt} onClick={()=>{setR2(1000);setGuess(null)}}><RotateCcw size={16} aria-hidden="true"/> Reset lesson</button>
            <Link className={s.cta} href="/lab?sample=divider">Try actual Lab <ArrowRight size={17} aria-hidden="true"/></Link>
          </div>
        </section>
      </div>
      <p className={s.footer}>Teaching exercise: a prepared 5 V resistor-divider fixture solved locally, with no AI extraction and no actual meter readings. For low-voltage learning only.</p>
    </main>
  </div>;
}
