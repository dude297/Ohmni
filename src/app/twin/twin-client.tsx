"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "../../components/ohmni/brand";
import { Schematic } from "./schematic";
import {
  BRIDGE_NETLIST, MAX_NETLIST_BYTES, applyScenario, diffModel, evidenceBadge, formatValue, formatVolts, graphFromRows, hasBridgeLayout,
  intendedBadge, observedBadge, parseEvidenceCsv, parseKicadNetlist, rowsFromGraph, valueBadge, verifyBadge,
  type Diff, type Graph, type Obs, type Row, type Scenario, type Source,
} from "./model";
import "./twin.css";

/* eslint-disable @typescript-eslint/no-explicit-any -- API result is contract-shaped but owned by another branch; read defensively. */
type Solution = { voltages: Record<string, number>; currents: Record<string, number> };
type TwinResult = {
  intended: { graph: Graph; provenance?: { kind?: string; name?: string; warnings?: string[] } };
  diff: Diff;
  intendedSolution: Solution;
  observedSolution: Solution | null;
  predictedVsMeasured?: { node: string; intended: number; observed: number | null; measured?: number }[];
  probe?: {
    hypotheses: { id: string; title: string; probability: number }[];
    next: { node: string; expectedBits?: number; instruction: string; outcomes: { volts: number; hypothesisIds: string[]; probability: number }[] } | null;
    done: boolean; reason?: string; fitWarning?: string; safety?: string;
  };
  repair?: { proposals: any[]; basis?: string; safety?: string };
};
type Reading = Obs & { source: Source };
type Api<T> = { ok: true; data: T } | { ok: false; unavailable?: boolean; error: string };

const STEPS = ["Design", "Reality", "Diff", "Measure", "Fix", "Verify"];

async function api<T>(url: string, payload: unknown): Promise<Api<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    if (res.status === 404) return { ok: false, unavailable: true, error: "not available on this build" };
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.result) return { ok: false, error: body?.error?.message ?? body?.error ?? `Request failed (${res.status}).` };
    return { ok: true, data: body.result as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error." };
  }
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const Badge = ({ children, tone = "ink" }: { children: React.ReactNode; tone?: "ink" | "fault" | "ok" | "sage" | "copper" }) => <span className={`tw-badge tw-b-${tone}`}>{children}</span>;

export function TwinClient() {
  const [step, setStep] = useState(1);
  const [netlist, setNetlist] = useState(BRIDGE_NETLIST);
  const [bridgePicked, setBridgePicked] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<TwinResult | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [rNode, setRNode] = useState("");
  const [rVolts, setRVolts] = useState("");
  const [csvMsg, setCsvMsg] = useState("");
  const [approved, setApproved] = useState(false);
  const [vVolts, setVVolts] = useState("");
  const [verify, setVerify] = useState<{ verified: boolean; status: string; delta?: number; message?: string } | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  const parsed = useMemo(() => {
    const p = parseKicadNetlist(netlist);
    if (p.graph && !p.graph.components.some((c) => c.positiveNode === "C" || c.negativeNode === "C")) {
      const n = p.graph.components.flatMap((c) => [c.positiveNode, c.negativeNode]).find((x) => x !== "GND");
      if (n) p.graph.measureNode = n;
    }
    return p;
  }, [netlist]);
  const design = parsed.graph;
  const obsBuilt = useMemo(() => (design ? graphFromRows(rows, design.measureNode) : { error: "" }), [rows, design]);
  const baseRows = useMemo(() => (design ? rowsFromGraph(design) : []), [design]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    headRef.current?.focus();
  }, [step]);

  const proposal = useMemo(() => [...(result?.repair?.proposals ?? [])].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0], [result]);
  const reach = [true, !!design, !!result, !!result, !!proposal, approved];
  const measured: Record<string, Source> = {};
  for (const r of readings) measured[r.node] = r.source;

  async function runTwin(list: Reading[]) {
    if (!design || !obsBuilt.graph) return false;
    setBusy(true); setError("");
    const r = await api<TwinResult>("/api/twin", {
      intended: { netlist, format: "kicad", measureNode: design.measureNode },
      observed: obsBuilt.graph,
      observedProvenance: { kind: "human_review", note: scenario ? "Observed table edited from an EXAMPLE scenario, reviewed by user" : "Observed table reviewed by user" },
      userConfirmed: true,
      ...(list.length ? { observations: list.map(({ node, volts }) => ({ node, volts })) } : {}),
    });
    setBusy(false);
    if (!r.ok) { setUnavailable(!!r.unavailable); setError(r.error); return false; }
    setUnavailable(false); setResult(r.data); setReadings(list);
    return true;
  }

  function goReality() {
    if (!design) return;
    setRows(baseRows); setScenario(null); setReviewed(false); setResult(null); setReadings([]); setApproved(false); setVerify(null); setError(""); setUnavailable(false);
    setStep(2);
  }
  function pickScenario(s: Scenario) {
    const next = scenario === s ? null : s;
    setScenario(next); setRows(applyScenario(baseRows, next)); setReviewed(false);
  }
  async function compare() {
    if (await runTwin([])) setStep(3);
  }
  async function addReadings(add: Reading[]) {
    const merged = [...readings.filter((r) => !add.some((a) => a.node === r.node)), ...add];
    if (await runTwin(merged)) { setRVolts(""); setApproved(false); setVerify(null); }
  }
  function submitReading() {
    const v = Number(rVolts);
    const node = rNode || result?.probe?.next?.node || design?.measureNode || "";
    if (rVolts.trim() === "" || !Number.isFinite(v)) { setError("Enter the voltage you measured, e.g. 3.21"); return; }
    void addReadings([{ node, volts: v, source: "typed" }]);
  }
  async function loadCsv(f: File | undefined) {
    if (!f) return;
    if (f.size > 64 * 1024) { setCsvMsg("File is over 64 KB."); return; }
    const { observations, errors } = parseEvidenceCsv(await f.text());
    if (errors.length) { setCsvMsg(errors[0]); return; }
    setCsvMsg(`Loaded ${observations.length} synthetic reading(s) from ${f.name}.`);
    void addReadings(observations.map((o) => ({ ...o, source: "file" as const })));
  }
  async function submitVerify() {
    const ver = proposal?.verification;
    const v = Number(vVolts);
    if (!ver || vVolts.trim() === "" || !Number.isFinite(v) || !result) { setError("Enter the post-fix voltage you measured."); return; }
    setBusy(true); setError("");
    const r = await api<any>("/api/repair/verify", { graph: result.intended.graph, userConfirmed: true, proposal: { hypothesisId: proposal.hypothesisId, verification: ver }, measured: { node: ver.node, volts: v } });
    setBusy(false);
    if (!r.ok) { setUnavailable(!!r.unavailable); setError(r.error); return; }
    setUnavailable(false); setVerify(r.data);
  }

  // ---- hero schematics
  const layoutOk = design ? hasBridgeLayout(design) : false;
  const dm = diffModel(result?.diff);
  const pulse = step === 4 ? result?.probe?.next?.node ?? null : null;
  const hero = !design ? null : step >= 3 && result ? (
    <div className="tw-dual">
      <figure className="tw-fig">
        <figcaption><Badge tone="sage">{intendedBadge(result.intended.provenance?.kind)}</Badge></figcaption>
        <Schematic graph={result.intended.graph ?? design} label="Intended circuit" voltages={result.intendedSolution?.voltages} pulseNode={pulse} />
      </figure>
      <figure className="tw-fig">
        <figcaption><Badge tone="copper">{observedBadge("human_review")}</Badge></figcaption>
        <Schematic graph={obsBuilt.graph ?? design} label="Observed circuit" tints={dm.valueTints} reroutes={dm.reroutes} voltages={result.observedSolution?.voltages} pulseNode={pulse} />
      </figure>
    </div>
  ) : step === 2 && obsBuilt.graph ? (
    <figure className="tw-fig"><figcaption><Badge tone="copper">{observedBadge("human_review")}</Badge> <Badge tone="fault">EXAMPLE edits are yours to review</Badge></figcaption><Schematic graph={obsBuilt.graph} label="Observed circuit" /></figure>
  ) : (
    <figure className="tw-fig"><figcaption><Badge tone="sage">{intendedBadge("kicad_netlist")}</Badge></figcaption><Schematic graph={design} label="Intended circuit" /></figure>
  );

  const nodes = Object.keys(result?.intendedSolution?.voltages ?? {}).filter((n) => n !== "GND");
  const cur = rNode && nodes.includes(rNode) ? rNode : result?.probe?.next?.node ?? design?.measureNode ?? "";

  return (
    <>
      <header className="site-header lab-header"><Brand /><nav><Link href="/probe" className="back-link">Probe Guide</Link></nav></header>
      <main className="tw-main">
        <h1 className="tw-title">Digital twin <span>I designed this. My hardware disagrees.</span></h1>
        <div role="status" aria-live="polite" className="tw-sr">Step {step} of 6: {STEPS[step - 1]}</div>
        <div className="tw-layout">
          <ol className="tw-rail" aria-label="Steps">
            {STEPS.map((n, i) => (
              <li key={n}>
                <button type="button" disabled={!reach[i]} aria-current={step === i + 1 ? "step" : undefined} className={step === i + 1 ? "tw-on" : ""} onClick={() => setStep(i + 1)}>
                  <b>{i + 1}</b><span>{n}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="tw-body">
            <section className="tw-hero" aria-label="Schematic">
              {hero}
              {design && !layoutOk && <p className="tw-note">Schematic drawing supports the loaded-bridge layout; this netlist is analysed without a drawing.</p>}
            </section>

            <section className="tw-panel" aria-labelledby="tw-h">
              <h2 id="tw-h" tabIndex={-1} ref={headRef}>{step}. {["Pick the design", "Describe what you built", "What differs", "Measure where it matters", "Fix it", "Verify the fix"][step - 1]}</h2>
              {unavailable && <p className="tw-err" role="alert">The twin service is not available on this build.</p>}
              {error && !unavailable && <p className="tw-err" role="alert">{error}</p>}

              {step === 1 && (
                <>
                  <div className="tw-pills">
                    <button type="button" className={bridgePicked ? "tw-on" : ""} onClick={() => { setNetlist(BRIDGE_NETLIST); setBridgePicked(true); }}>Loaded bridge (KiCad netlist)</button>
                    <button type="button" className={!bridgePicked ? "tw-on" : ""} onClick={() => { setNetlist(""); setBridgePicked(false); }}>Paste a netlist</button>
                  </div>
                  <label htmlFor="tw-net" className="tw-lab">KiCad .net text (max 64 KB)</label>
                  <textarea id="tw-net" rows={7} value={netlist} spellCheck={false} onChange={(e) => { setNetlist(e.target.value.slice(0, MAX_NETLIST_BYTES)); setBridgePicked(false); }} />
                  {parsed.error && <p className="tw-err">{parsed.error}</p>}
                  {design && <p className="tw-muted"><Badge tone="sage">{intendedBadge("kicad_netlist")}</Badge> {design.components.length} parts, measure node {design.measureNode}</p>}
                  <button type="button" className="tw-go" disabled={!design} onClick={goReality}>Next: describe my hardware</button>
                </>
              )}

              {step === 2 && (
                <>
                  <p className="tw-muted"><Badge tone="copper">{observedBadge("human_review")}</Badge> You describe the build. Ohmni does not read photos here.</p>
                  <div className="tw-pills" role="group" aria-label="Example scenarios">
                    <span className="tw-ex">EXAMPLE</span>
                    <button type="button" aria-pressed={scenario === "value"} className={scenario === "value" ? "tw-on" : ""} onClick={() => pickScenario("value")}>R6 is 6.8 kΩ (value fault)</button>
                    <button type="button" aria-pressed={scenario === "wiring"} className={scenario === "wiring" ? "tw-on" : ""} onClick={() => pickScenario("wiring")}>R6 wired to GND (wiring fault)</button>
                  </div>
                  <div className="tw-tablewrap">
                    <table className="tw-table">
                      <thead><tr><th>Part</th><th>Value</th><th>+ node</th><th>− node</th></tr></thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const b = baseRows[i];
                          const edit = (k: "value" | "pos" | "neg") => (e: React.ChangeEvent<HTMLInputElement>) => { setRows(rows.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x))); setReviewed(false); };
                          const ch = (k: "value" | "pos" | "neg") => (b && b[k] !== r[k] ? "tw-changed" : "");
                          return (
                            <tr key={r.id}>
                              <th scope="row">{r.id}</th>
                              <td><input aria-label={`${r.id} value`} className={ch("value")} value={r.value} onChange={edit("value")} inputMode="decimal" /></td>
                              <td><input aria-label={`${r.id} positive node`} className={ch("pos")} value={r.pos} onChange={edit("pos")} /></td>
                              <td><input aria-label={`${r.id} negative node`} className={ch("neg")} value={r.neg} onChange={edit("neg")} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {obsBuilt.error && <p className="tw-err">{obsBuilt.error}</p>}
                  <label className="tw-check"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed the observed circuit</label>
                  <button type="button" className="tw-go" disabled={!reviewed || !obsBuilt.graph || busy} onClick={compare}>{busy ? "Comparing…" : "Compare with the design"}</button>
                </>
              )}

              {step === 3 && result && (
                <>
                  {result.diff.identical && <p className="tw-ok">Observed matches the design. Measure to look for something the netlist cannot show.</p>}
                  <ul className="tw-diffs">
                    {Object.entries(dm.valueTints).map(([id, t]) => <li key={id} className="tw-fault"><b>{id}</b> {t}</li>)}
                    {dm.reroutes.map((r) => <li key={r.label} className="tw-fault"><b>{r.label}</b></li>)}
                    {dm.structural.map((s) => <li key={s} className="tw-fault">{s}</li>)}
                  </ul>
                  <div className="tw-nums">
                    {(result.predictedVsMeasured ?? []).map((p) => (
                      <div key={p.node} className="tw-num">
                        <small>Node {p.node}</small>
                        <span className="tw-n1">{formatVolts(p.intended)}</span>
                        <span className={`tw-n2 ${p.observed !== null && Math.abs(p.observed - p.intended) > 0.01 ? "tw-fault" : ""}`}>{p.observed === null ? "—" : formatVolts(p.observed)}</span>
                        {p.measured !== undefined && <span className="tw-n3">{formatVolts(p.measured)} <Badge tone="copper">{evidenceBadge(measured[p.node] ?? "typed")}</Badge></span>}
                      </div>
                    ))}
                  </div>
                  <p className="tw-muted">Large numerals: intended (top) vs observed circuit (bottom), both simulated.</p>
                  <button type="button" className="tw-go" onClick={() => setStep(4)}>Next: where should I measure?</button>
                </>
              )}

              {step === 4 && result && (
                <>
                  {result.probe?.next && !result.probe.done && (
                    <div className="tw-next">
                      <small>PROBE NEXT</small>
                      <p className="tw-big">Node <mark>{result.probe.next.node}</mark></p>
                      <p>{result.probe.next.instruction}</p>
                      <ul className="tw-outs" aria-label="What each reading would mean">
                        {result.probe.next.outcomes.map((o, i) => (
                          <li key={i}><b>{o.volts.toFixed(2)} V</b><i style={{ width: `${Math.max(4, o.probability * 100)}%` }} /><span>{pct(o.probability)} · {o.hypothesisIds.join(", ")}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.probe?.done && <p className="tw-ok">{result.probe.reason ?? "Enough evidence collected."}</p>}
                  {result.probe?.fitWarning && <p className="tw-warn">{result.probe.fitWarning}</p>}
                  <div className="tw-read">
                    <label htmlFor="tw-rn" className="tw-lab">Node</label>
                    <select id="tw-rn" value={cur} onChange={(e) => setRNode(e.target.value)}>{nodes.map((n) => <option key={n}>{n}</option>)}</select>
                    <label htmlFor="tw-rv" className="tw-lab">Volts</label>
                    <input id="tw-rv" inputMode="decimal" value={rVolts} onChange={(e) => setRVolts(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitReading()} placeholder="e.g. 3.21" />
                    <button type="button" className="tw-go" disabled={busy} onClick={submitReading}>{busy ? "Updating…" : "Add reading"}</button>
                  </div>
                  <label className="tw-file">Load CSV (SYNTHETIC test file: node,value,unit)
                    <input type="file" accept=".csv,text/csv" onChange={(e) => { void loadCsv(e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                  {csvMsg && <p className="tw-muted" role="status">{csvMsg}</p>}
                  {readings.length > 0 && (
                    <ul className="tw-chips">{readings.map((r) => <li key={r.node}>{r.node}: <b>{formatVolts(r.volts)}</b> <Badge tone="copper">{evidenceBadge(r.source)}</Badge></li>)}</ul>
                  )}
                  {!!result.probe?.hypotheses?.length && (
                    <ul className="tw-hyp" aria-label="Hypotheses">
                      {result.probe.hypotheses.map((h) => (
                        <li key={h.id}><span>{h.title}</span><i><b style={{ width: pct(h.probability) }} /></i><em>{pct(h.probability)}</em></li>
                      ))}
                    </ul>
                  )}
                  {result.probe?.safety && <p className="tw-muted">{result.probe.safety}</p>}
                  <button type="button" className="tw-go" disabled={!proposal} onClick={() => setStep(5)}>{proposal ? "See the fix" : "Add readings to get a fix"}</button>
                </>
              )}

              {step === 5 && proposal && result && (
                <>
                  <div className="tw-fix">
                    <small>MOST LIKELY · {pct(proposal.probability ?? 0)}</small>
                    <p className="tw-big">{proposal.title}</p>
                    <p className="tw-patch"><b>{proposal.patch?.componentId}</b>: restore {formatValue(proposal.patch?.designValue ?? 0, proposal.patch?.unit === "V" ? "dc_voltage" : "resistor")}
                      <span> (now {formatValue(proposal.patch?.faultedValue ?? 0, proposal.patch?.unit === "V" ? "dc_voltage" : "resistor")})</span></p>
                    <div className="tw-ba">
                      {Object.keys(proposal.after?.voltages ?? {}).filter((n) => n !== "GND").map((n) => (
                        <div key={n} className="tw-num">
                          <small>Node {n}</small>
                          <span className="tw-n2 tw-fault">{formatVolts(proposal.before?.voltages?.[n] ?? NaN)}</span>
                          <Badge tone={n in measured ? "copper" : "sage"}>{valueBadge(n, measured)}</Badge>
                          <span className="tw-n1">{formatVolts(proposal.after.voltages[n])}</span>
                          <Badge tone="sage">SIMULATED</Badge>
                        </div>
                      ))}
                    </div>
                    <p className="tw-muted">Per node: before (top), after the fix (bottom). The after values are what the model predicts, not a measurement.</p>
                    <ol className="tw-actions">{(proposal.actions ?? []).map((a: string, i: number) => <li key={i}>{a}</li>)}</ol>
                    {proposal.uncertainty && <p className="tw-muted">{typeof proposal.uncertainty === "string" ? proposal.uncertainty : null}</p>}
                    {result.repair?.safety && <p className="tw-muted">{result.repair.safety}</p>}
                  </div>
                  <button type="button" className="tw-go" onClick={() => { setApproved(true); setStep(6); }}>Approve plan (Ohmni makes no physical change)</button>
                </>
              )}

              {step === 6 && proposal && (
                <>
                  <p>{proposal.verification?.instruction}</p>
                  <p className="tw-muted">Expect {proposal.verification?.expectVolts?.toFixed?.(3)} V ± {proposal.verification?.toleranceVolts} V at node {proposal.verification?.node}.</p>
                  <div className="tw-read">
                    <label htmlFor="tw-vv" className="tw-lab">Node {proposal.verification?.node} after the fix (V)</label>
                    <input id="tw-vv" inputMode="decimal" value={vVolts} onChange={(e) => setVVolts(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitVerify()} />
                    <button type="button" className="tw-go" disabled={busy} onClick={submitVerify}>{busy ? "Checking…" : "Verify"}</button>
                  </div>
                  {verify && (
                    <div className={verifyBadge(verify) === "VERIFIED" ? "tw-verdict tw-v-ok" : "tw-verdict tw-v-bad"} role="status">
                      <b>{verifyBadge(verify)}</b>
                      <span>{verify.message}</span>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
