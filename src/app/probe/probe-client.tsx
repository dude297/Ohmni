"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, GraduationCap, Loader2, Undo2, X } from "lucide-react";
import { Brand } from "../../components/ohmni/brand";
import { CircuitView } from "../../components/ohmni/circuit-view";
import type { FaultHypothesis, ProbeStep } from "../../lib/probe";
import type { ModelTraceEvent } from "../../lib/circuit/types";
import { CIRCUITS, Obs, addObservation, apiErrorMessage, fmtPct, fmtV, parseVolts } from "./helpers";
import { GuidePanel, ProbeSchematic } from "./guide-overlay";
import "./probe.css";

// Classes are prefixed "pg-" in probe.css (see note there); s.foo -> "pg-foo".
const s = new Proxy({} as Record<string, string>, { get: (_, k) => `pg-${String(k)}` });

type ProbeResult = ProbeStep & { trace?: ModelTraceEvent[] };
type Explain = {
  explanation: { summary: string; steps: { title: string; text: string }[] } | null;
  grounded: boolean;
  ungroundedNumbers: string[];
  facts?: { voltages?: Record<string, number>; currents?: Record<string, number>; hypotheses?: { title: string }[] };
  trace?: ModelTraceEvent[];
};

async function post(url: string, payload: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => null);
  return { res, body };
}

const TraceList = ({ trace }: { trace?: ModelTraceEvent[] }) =>
  trace?.length ? (
    <ul className={s.trace}>
      {trace.map((t, i) => (
        <li key={i}>
          <code>{t.step}</code> · {t.provider}
          {t.model ? ` / ${t.model}` : ""} · {t.status} · {t.durationMs} ms{t.note ? ` · ${t.note}` : ""}
        </li>
      ))}
    </ul>
  ) : null;

export function ProbeClient() {
  const [ci, setCi] = useState(0);
  const circuit = CIRCUITS[ci];
  const graph = circuit.graph;
  const [obs, setObs] = useState<Obs[]>([]);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exp, setExp] = useState<Explain | null>(null);
  const [expLoading, setExpLoading] = useState(false);
  const [expError, setExpError] = useState("");

  const [guideOpen, setGuideOpen] = useState(true);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeGuide = useCallback(() => {
    if (document.activeElement?.closest(".pg-guide")) toggleRef.current?.focus();
    setGuideOpen(false);
  }, []);

  const node = result?.next?.node ?? graph.measureNode;
  const value = parseVolts(input);

  async function run(list: Obs[]) {
    setLoading(true);
    setError("");
    try {
      const { res, body } = await post("/api/probe", { graph, userConfirmed: true, observations: list });
      if (!res.ok || !body?.result) throw new Error(apiErrorMessage(res.status, body, res.headers.get("retry-after")));
      setObs(list);
      setResult(body.result);
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Probe request failed.");
    } finally {
      setLoading(false);
    }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value === null) return setError("Enter a number in volts, for example 2.5");
    run(addObservation(obs, { node, volts: value }));
  };
  const undo = (n: string) => {
    const list = obs.filter((o) => o.node !== n);
    if (list.length) run(list);
    else {
      setObs([]);
      setResult(null);
      setError("");
    }
  };
  const reset = (i: number) => {
    setCi(i);
    setObs([]);
    setResult(null);
    setInput("");
    setError("");
    setExp(null);
    setExpError("");
  };

  async function explain() {
    setExpLoading(true);
    setExpError("");
    try {
      const measured = obs.find((o) => o.node === graph.measureNode)?.volts;
      const { res, body } = await post("/api/explain", { graph, userConfirmed: true, ...(measured !== undefined && { measuredVoltage: measured }) });
      if (!res.ok || !body?.result) {
        setExp(null);
        setExpError(res.status === 429 ? apiErrorMessage(429, body, res.headers.get("retry-after")) : "Tutor unavailable right now. The Probe Guide above still works.");
        return;
      }
      setExp(body.result);
    } catch {
      setExpError("Tutor unavailable right now. The Probe Guide above still works.");
    } finally {
      setExpLoading(false);
    }
  }

  const top: FaultHypothesis[] = result?.hypotheses.slice(0, 5) ?? [];
  const titleOf = (ids: string[]) =>
    ids.map((id) => result?.hypotheses.find((h) => h.id === id)?.title ?? id);

  return (
    <div className="ohmni lab-page">
      <header className="site-header lab-header">
        <Brand />
        <nav aria-label="Probe navigation">
          <Link href="/lab" className="back-link">
            <ArrowLeft size={15} /> Back to workspace
          </Link>
          <span className="workspace-tag">
            <span className="tiny-dot" /> PROBE GUIDE
          </span>
        </nav>
      </header>

      <main className={s.main}>
        <div className={s.title}>
          <h1>Where should I probe next?</h1>
          <p>One wrong reading doesn&apos;t tell you which part failed. Ohmni tells you where to probe next.</p>
        </div>

        <div className={s.grid}>
          <section className={`workspace-panel ${s.panel}`} aria-labelledby="circ-h">
            <h2 id="circ-h" className={s.h2}>1. Circuit</h2>
            <div className={s.picker} role="group" aria-label="Choose a circuit">
              {CIRCUITS.map((c, i) => (
                <button key={c.key} type="button" aria-pressed={i === ci} disabled={loading} className={`${s.pick} ${i === ci ? s.pickOn : ""}`} onClick={() => reset(i)}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className={s.muted}>{circuit.blurb}</p>
            <div className="circuit-canvas">
              <CircuitView graph={graph} />
            </div>
            <ProbeSchematic graph={graph} highlight={result ? (result.done ? null : result.next?.node ?? null) : graph.measureNode} />
            {result && !result.done && result.next && (
              <>
                <button ref={toggleRef} type="button" className={`button secondary ${s.toggle}`} aria-expanded={guideOpen} onClick={() => (guideOpen ? closeGuide() : setGuideOpen(true))}>
                  {guideOpen ? "Hide guide" : "Show guide"}
                </button>
                <GuidePanel
                  step={result}
                  open={guideOpen}
                  onClose={closeGuide}
                  titleOf={titleOf}
                  onEnter={() => document.getElementById("v1")?.focus()}
                />
              </>
            )}

            <h3 className={s.h3}>Your readings</h3>
            {obs.length === 0 ? (
              <p className={s.muted}>None yet. Measure the DC voltage at <b>{graph.measureNode}</b> (black probe on GND).</p>
            ) : (
              <ul className={s.chips} aria-label="Readings">
                {obs.map((o) => (
                  <li key={o.node} className={s.chip}>
                    <b>{o.node}</b> = {fmtV(o.volts)}
                    <button type="button" aria-label={`Undo reading at ${o.node}`} disabled={loading} onClick={() => undo(o.node)}>
                      <Undo2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`workspace-panel ${s.panel}`} aria-labelledby="probe-h" aria-live="polite">
            <h2 id="probe-h" className={s.h2}>2. {result?.done ? "Conclusion" : "Next probe"}</h2>

            {error && (
              <div className={s.errorBox} role="alert">
                <X size={16} /> {error}
              </div>
            )}

            {!result && (
              <form onSubmit={submit} className={s.form}>
                <label htmlFor="v0">Reading at <b>{node}</b> (volts)</label>
                <div className={s.row}>
                  <input id="v0" inputMode="decimal" placeholder="e.g. 0" value={input} onChange={(e) => setInput(e.target.value)} disabled={loading} />
                  <button className="button primary" disabled={loading || value === null}>
                    {loading ? <Loader2 className={s.spin} size={16} /> : null} Guide me
                  </button>
                </div>
              </form>
            )}

            {result?.fitWarning && (
              <div className={s.warn} role="status">
                <AlertTriangle size={16} /> {result.fitWarning}
              </div>
            )}

            {result && !result.done && result.next && (
              <div className={s.probeCard}>
                <div className={s.eyebrow}>MEASURE NEXT</div>
                <div className={s.big}>
                  Measure <span>{result.next.node}</span> next
                </div>
                <p>{result.next.instruction}</p>
                <p className={s.muted}>Expected information: {result.next.expectedBits.toFixed(2)} bits</p>

                <h3 className={s.h3}>What each reading would mean</h3>
                <ul className={s.outcomes}>
                  {result.next.outcomes.slice(0, 6).map((o) => (
                    <li key={o.hypothesisIds.join("|")}>
                      <div className={s.outV}>≈ {fmtV(o.volts)}</div>
                      <div className={s.outWhy}>{titleOf(o.hypothesisIds).slice(0, 3).join("; ")}{o.hypothesisIds.length > 3 ? ` +${o.hypothesisIds.length - 3} more` : ""}</div>
                      <div className={s.outP}>{fmtPct(o.probability)}</div>
                    </li>
                  ))}
                </ul>

                <form onSubmit={submit} className={s.form}>
                  <label htmlFor="v1">Reading at <b>{node}</b> (volts)</label>
                  <div className={s.row}>
                    <input id="v1" inputMode="decimal" placeholder="volts" value={input} onChange={(e) => setInput(e.target.value)} disabled={loading} />
                    <button className="button primary" disabled={loading || value === null}>
                      {loading ? <Loader2 className={s.spin} size={16} /> : null} Submit reading
                    </button>
                  </div>
                </form>
              </div>
            )}

            {result?.done && (
              <div className={s.done}>
                <CheckCircle2 size={22} />
                <div>
                  <b>Diagnosis</b>
                  <p>{result.reason}</p>
                </div>
              </div>
            )}

            {result && (
              <>
                <h3 className={s.h3}>Hypotheses</h3>
                <ul className={s.bars}>
                  {top.map((h) => (
                    <li key={h.id}>
                      <div className={s.barTop}>
                        <span>{h.title}</span>
                        <b>{fmtPct(h.probability)}</b>
                      </div>
                      <div className={s.track}><div className={s.fill} style={{ width: `${Math.max(2, h.probability * 100)}%` }} /></div>
                    </li>
                  ))}
                </ul>
                <p className={s.safety}>{result.safety}</p>
                <details className={s.how}>
                  <summary>How this was computed</summary>
                  <p>Every candidate fault is re-solved by the circuit solver; the next probe is the node that best splits the remaining possibilities. No AI model is used for this step.</p>
                  <TraceList trace={result.trace} />
                </details>
              </>
            )}
          </section>
        </div>

        <section className={`workspace-panel ${s.panel} ${s.tutor}`} aria-labelledby="tutor-h" aria-live="polite">
          <h2 id="tutor-h" className={s.h2}><GraduationCap size={18} /> Explain this circuit</h2>
          <p className={s.muted}>A tutor explains {circuit.label.toLowerCase()} step by step. Every number is checked against the solver.</p>
          <button type="button" className="button secondary" onClick={explain} disabled={expLoading}>
            {expLoading ? <Loader2 className={s.spin} size={16} /> : null} {expLoading ? "Explaining…" : "Explain this circuit"}
          </button>
          {expError && <div className={s.errorBox} role="alert"><X size={16} /> {expError}</div>}
          {exp && (
            <div className={s.explain}>
              {exp.grounded ? (
                <div className={s.okBadge}><CheckCircle2 size={15} /> Every number checked against the solver</div>
              ) : exp.explanation && (
                <div className={s.warn}><AlertTriangle size={16} /> Some numbers could not be verified{exp.ungroundedNumbers?.length ? `: ${exp.ungroundedNumbers.join(", ")}` : ""}</div>
              )}
              {exp.explanation ? (
                <>
                  <p className={s.summary}>{exp.explanation.summary}</p>
                  <ol className={s.steps}>
                    {exp.explanation.steps.map((st, i) => (
                      <li key={i}><b>{st.title}</b><p>{st.text}</p></li>
                    ))}
                  </ol>
                </>
              ) : (
                <>
                  <p className={s.muted}>No written explanation was produced (the tutor model was unavailable). Solver facts:</p>
                  <ul className={s.facts}>
                    {Object.entries(exp.facts?.voltages ?? {}).map(([n, v]) => (
                      <li key={n}>{n}: {fmtV(v)}</li>
                    ))}
                  </ul>
                </>
              )}
              <details className={s.how}>
                <summary>How this was computed</summary>
                <TraceList trace={exp.trace} />
              </details>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
