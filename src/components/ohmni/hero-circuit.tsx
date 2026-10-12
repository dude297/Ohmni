"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, LoaderCircle, Zap } from "lucide-react";
import { CircuitView } from "./circuit-view";
import { formatValue, parseResult, request, sampleGraph, solveSample, type Result } from "./api";

export function HeroCircuit() {
  const [selected, setSelected] = useState("R2");
  const [resistance, setResistance] = useState(10000);
  const [verified, setVerified] = useState<Result | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const graph = sampleGraph();
  graph.components.find((c) => c.id === "R2")!.value = resistance;
  const result = verified ?? solveSample(graph);
  const component = graph.components.find((c) => c.id === selected)!;
  function changeResistance(value: number) {
    setResistance(value);
    setSelected("R2");
    setVerified(null);
    setConfirmed(false);
    setError("");
  }
  async function verify() {
    if (!confirmed || pending) return;
    setPending(true);
    setError("");
    try {
      const next = parseResult(await request("/api/solve", { graph, userConfirmed: true }));
      if (next.voltages.VOUT === undefined) throw new Error("Solver did not return VOUT.");
      setVerified(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backend verification failed.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="hero-instrument">
      <div className="instrument-top">
        <span>
          <span className="tiny-dot" /> THE CIRCUIT, EXPLAINED
        </span>
        <span className="sample-tag">{verified ? "BACKEND VERIFIED" : "LOCAL PREVIEW"}</span>
      </div>
      <div className="hero-body"><div className="hero-live-circuit"><CircuitView
        graph={graph}
        selected={selected}
        onSelect={pending ? undefined : setSelected}
        result={result}
      /></div><div className="hero-live-controls">
      <div className="instrument-controls">
        <div>
          <span className="eyebrow">PREDICTED VOUT</span>
          <strong aria-live="polite">
            {result.voltages.VOUT.toFixed(3)}
            <small> V</small>
          </strong>
        </div>
        <button
          className="switch-value"
          disabled={pending}
          onClick={() => changeResistance(resistance === 1000 ? 10000 : 1000)}
        >
          Set R2 to {resistance === 1000 ? "10 kΩ" : "1 kΩ"}
          <ArrowUpRight size={16} />
        </button>
      </div>
      <div className="hero-experiment">
        <label htmlFor="hero-resistance">Explore R2 <strong>{formatValue(resistance, "resistor")}</strong></label>
        <input id="hero-resistance" aria-label="Explore R2 resistance" type="range" min="1000" max="20000" step="1000" value={resistance} disabled={pending} onChange={(e) => changeResistance(Number(e.target.value))} />
        <div className="hero-inspector"><span>Selected {component.id}</span><strong>{formatValue(component.value, component.kind)}</strong><span>{component.positiveNode} → {component.negativeNode}</span></div>
        <label className="hero-confirm"><input type="checkbox" checked={confirmed} disabled={pending} onChange={(e) => { setConfirmed(e.target.checked); setVerified(null); }} /> I reviewed the sample values and connections.</label>
        <button className="hero-verify" disabled={pending || !confirmed} onClick={() => void verify()}>
          {pending ? <LoaderCircle size={15} className="spinner" /> : verified ? <Check size={15} /> : <Zap size={15} />}
          {pending ? "Waiting for solver…" : "Verify sample with backend"}
        </button>
        <p className="hero-proof" aria-live="polite">{verified ? `Actual server result${verified.trace[0] ? ` · ${verified.trace[0].provider}${verified.trace[0].model ? ` / ${verified.trace[0].model}` : ""} · ${verified.trace[0].durationMs} ms` : ""}. No vision model was called.` : "Slider uses a local divider preview. Verify to run the real server solver."}</p>
        {error && <p className="hero-error" role="alert">{error} The value shown is a local preview.</p>}
      </div>
      </div></div><div className="instrument-note">
        {resistance === 10000 ? "Equal resistors. Half the supply voltage." : "One component changes the whole story."}{" "}
        <Link href="/lab?sample=divider">Inspect circuit →</Link>
      </div>
    </div>
  );
}
