"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert, Crosshair, LoaderCircle, X } from "lucide-react";
import type { Observation, ProbeStep } from "../../lib/probe";
import { isTrace, request, type Graph, type Trace } from "./api";

type Result = ProbeStep & { trace: Trace[] };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const probability = (v: unknown) => finite(v) && v >= 0 && v <= 1;

function parseStep(value: unknown, nodes: string[]): Result {
  if (!record(value) || !record(value.result)) throw new Error("Probe guide returned an invalid response.");
  const r = value.result;
  if (typeof r.done !== "boolean" || typeof r.reason !== "string" || typeof r.safety !== "string" || (r.fitWarning !== undefined && typeof r.fitWarning !== "string") || !isTrace(r.trace) || !Array.isArray(r.hypotheses) || r.hypotheses.length > 200 || !r.hypotheses.every(h => record(h) && typeof h.id === "string" && typeof h.title === "string" && probability(h.probability) && record(h.predicted) && Object.values(h.predicted).every(finite))) throw new Error("Probe guide returned invalid hypothesis evidence.");
  const ids = r.hypotheses.map(h => (h as Record<string, unknown>).id);
  if (r.next !== null && (!record(r.next) || typeof r.next.node !== "string" || !nodes.includes(r.next.node) || !finite(r.next.expectedBits) || r.next.expectedBits < 0 || typeof r.next.instruction !== "string" || !Array.isArray(r.next.outcomes) || r.next.outcomes.length > 200 || !r.next.outcomes.every(o => record(o) && finite(o.volts) && probability(o.probability) && Array.isArray(o.hypothesisIds) && o.hypothesisIds.every(id => typeof id === "string" && ids.includes(id))))) throw new Error("Probe guide returned an invalid next measurement.");
  if (r.done && r.next !== null) throw new Error("Probe guide returned conflicting investigation state.");
  return r as Result;
}

export function ProbeGuide({ graph, initialVoltage, onTarget }: { graph: Graph; initialVoltage: number; onTarget: (node: string | undefined) => void }) {
  const [observations, setObservations] = useState<Observation[]>([{ node: graph.measureNode, volts: initialVoltage }]);
  const [step, setStep] = useState<Result | null>(null);
  const [reading, setReading] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const nodes = [...new Set(graph.components.flatMap(c => [c.positiveNode, c.negativeNode]))];
  async function update(next: Observation[]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const result = parseStep(await request("/api/probe", { graph, userConfirmed: true, observations: next }), nodes);
      if (!active.current) return;
      setObservations(next);
      setStep(result);
      setReading("");
      onTarget(result.next?.node);
    } catch (e) {
      if (!active.current) return;
      setError(e instanceof Error ? e.message : "The probe guide could not complete.");
    } finally { inFlight.current = false; if (active.current) setPending(false); }
  }
  return <section className="probe-guide" aria-labelledby="probe-heading" aria-busy={pending}>
    <div className="probe-header"><Crosshair size={19} /><div><span className="eyebrow">SOLVER-BACKED INVESTIGATION</span><h3 id="probe-heading">What should I check next?</h3></div></div>
    <p className="probe-intro">One reading can fit several faults. Compare them using additional measurements.</p>
    {(!step || error) && <button className="button primary small" disabled={pending} onClick={() => void update(observations)}>{pending ? <LoaderCircle size={15} className="spinner" /> : <Crosshair size={15} />} {error ? "Retry guide" : "Guide me"} <ArrowRight size={14} /></button>}
    {error && <p className="probe-error" role="alert">{error} Your previous reading history is preserved.</p>}
    {step && <>
      <div className="probe-history" aria-label="Investigation readings">{observations.map((o, i) => <button key={`${o.node}-${i}`} disabled={pending} aria-label={`Remove reading ${o.node} ${o.volts} volts`} onClick={() => void update(observations.filter((_, index) => index !== i))}>{o.node} = {o.volts} V <X size={12} /></button>)}{!observations.length && <span>No observations yet.</span>}</div>
      {step.fitWarning && <p className="probe-warning" role="alert"><CircleAlert size={16} />{step.fitWarning}</p>}
      {step.next ? <div className="next-probe"><span className="eyebrow">NEXT MEASUREMENT</span><h4>Measure <strong>{step.next.node}</strong></h4><p>{step.next.instruction}</p><details className="probe-outcomes"><summary>Why this node? {step.next.expectedBits.toFixed(2)} estimated bits</summary><p>Predictions under the modeled faults, not actual instrument readings:</p>{step.next.outcomes.map((outcome, i) => <div key={i}><strong>≈ {outcome.volts.toFixed(3)} V</strong><span>{outcome.hypothesisIds.map(id => step.hypotheses.find(h => h.id === id)?.title ?? id).join(" / ")}</span></div>)}</details><form onSubmit={(e) => { e.preventDefault(); if (step.next && reading.trim() && Number.isFinite(Number(reading))) void update([...observations, { node: step.next.node, volts: Number(reading) }]); }}><label htmlFor="probe-reading">Your measured {step.next.node} (V)</label><div><input id="probe-reading" type="number" step="any" value={reading} disabled={pending} onChange={(e) => setReading(e.target.value)} placeholder="Enter your meter reading" /><button type="submit" disabled={pending || !reading.trim() || !Number.isFinite(Number(reading))}>{pending ? <LoaderCircle size={15} className="spinner" /> : <ArrowRight size={15} />} Update investigation</button></div></form></div> : step.fitWarning ? <div className="probe-conclusion"><span className="eyebrow">MORE EVIDENCE NEEDED</span><p>The current readings do not fit the modeled faults. Recheck the diagram and measurements before drawing a conclusion.</p></div> : <div className="probe-conclusion"><span className="eyebrow">MODEL RESULT · VERIFY PHYSICALLY</span><p>{step.reason}</p></div>}
      <div className="probe-hypotheses"><strong>Remaining modeled possibilities</strong>{step.hypotheses.slice(0, 5).map(h => <div key={h.id}><span>{h.title}</span><div><meter min="0" max="1" value={h.probability} aria-label={`${h.title}: model-relative probability`} /><small>{(h.probability * 100).toFixed(1)}%</small></div></div>)}</div>
      <p className="probe-limits">Model-relative probabilities use assumed priors and a single-fault model. They are not calibrated physical confidence or proof of a fault.</p>
      <p className="probe-safety">{step.safety}</p>
      <div className="probe-provenance">{step.trace.map((t, i) => <span key={i}>{t.provider}{t.model ? ` / ${t.model}` : ""} · {t.durationMs} ms · {t.status}</span>)}</div>
    </>}
  </section>;
}
