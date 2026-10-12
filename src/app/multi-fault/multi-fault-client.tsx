"use client";

import Link from "next/link";
import { useState } from "react";
import { LOADED_BRIDGE_12V } from "../../lib/circuit/fixtures";
import type { ProbeStepMulti } from "../../lib/probe-multi";
import type { ModelTraceEvent } from "../../lib/circuit/types";
import "./multi-fault.css";

const NODES = ["A", "B", "C"] as const;
// Demo readings = solveDC of the bridge with R3 x10 + R7 open (see tests/probe-multi/multi.test.ts).
const DEMO: Record<string, string> = { A: "7.014", B: "2.136", C: "2.136" };
type Result = ProbeStepMulti & { trace: ModelTraceEvent[] };
const pct = (p: number) => `${(p * 100).toFixed(p > 0.995 || p < 0.0005 ? 2 : 1)}%`;

export function MultiFaultClient() {
  const [vals, setVals] = useState<Record<string, string>>({ A: "", B: "", C: "" });
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);

  const run = async () => {
    const observations = NODES.filter((n) => vals[n].trim() !== "").map((node) => ({ node, volts: Number(vals[node]) }));
    if (observations.some((o) => !Number.isFinite(o.volts))) return setError("Readings must be numbers in volts, e.g. 2.14");
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/probe-multi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph: LOADED_BRIDGE_12V, userConfirmed: confirmed, observations }) });
      const j = await r.json().catch(() => null);
      if (r.status === 429) throw new Error(`Rate limit reached. Wait ${r.headers.get("retry-after") ?? "a minute"}s and try again.`);
      if (!r.ok) throw new Error(j?.error?.message ?? `Request failed (${r.status})`);
      setRes(j.result);
    } catch (e) { setError((e as Error).message); setRes(null); }
    setBusy(false);
  };

  const pairs = res?.hypotheses.filter((h) => h.id.includes("+")).slice(0, 5) ?? [];
  const top = res?.hypotheses[0];
  const decided = !!res && res.done && !!top && top.probability >= 0.9;

  return (
    <>
      <header className="mf-head">
        <Link href="/" className="mf-link">Ohmni home</Link>
        <Link href="/tracks" className="mf-link">Workspaces</Link>
      </header>
      <main className="mf-main">
        <h1>Multi-fault diagnosis</h1>
        <p className="mf-banner" role="note"><strong>Hypotheses, not confirmed faults.</strong> Candidates are ranked by how well a DC re-solve of each fault (or pair of faults) matches your readings. Confirm each part with power off and an ohmmeter.</p>
        <p className="mf-muted">Circuit: the loaded 12 V bridge fixture (V1, R1 to R7). Probe with the black lead on GND and enter whichever of A, B, C you measured.</p>

        <div className="mf-card">
          {NODES.map((n) => (
            <div key={n}>
              <label htmlFor={`mf-${n}`}>Node {n} voltage (V)</label>{" "}
              <input id={`mf-${n}`} type="text" inputMode="decimal" value={vals[n]} onChange={(e) => setVals({ ...vals, [n]: e.target.value })} placeholder="e.g. 2.14" />
            </div>
          ))}
          <button className="mf-btn mf-ghost" type="button" onClick={() => setVals(DEMO)}>Fill demo readings (R3 x10 + R7 open)</button>
          <label className="mf-check" htmlFor="mf-confirm">
            <input id="mf-confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I confirm this circuit
          </label>
          <button className="mf-btn" onClick={run} disabled={!confirmed || busy}>{busy ? "Ranking..." : "Rank fault hypotheses"}</button>
        </div>

        {error && <p className="mf-error" role="alert">{error}</p>}

        {res && top && (
          <section aria-label="Results">
            <p className={`mf-status ${decided ? "" : "mf-amb"}`} role="status">
              {decided
                ? `One hypothesis dominates (${pct(top.probability)}): ${top.title}. Still a hypothesis.`
                : `Not done / ambiguous: no hypothesis reaches 90%. ${res.reason}`}
            </p>
            {res.fitWarning && <p className="mf-status mf-amb">{res.fitWarning}</p>}
            <h2>Ranked fault pairs (hypotheses)</h2>
            {pairs.length === 0 ? <p className="mf-muted">No two-fault candidates were solved.</p> : (
              <ol className="mf-list">
                {pairs.map((h, i) => (
                  <li key={h.id} className={`mf-row ${i === 0 ? "mf-top" : ""}`}>
                    <span className="mf-pct">{pct(h.probability)}</span> <strong>{h.id}</strong>
                    <div>{h.title.replace("Two independent faults: ", "")}</div>
                    <div className="mf-bar"><span style={{ width: `${Math.max(1, h.probability * 100)}%` }} /></div>
                  </li>
                ))}
              </ol>
            )}
            <p className="mf-muted">Overall best (singles and pairs): {top.id} at {pct(top.probability)}. {res.pairsSolved} pair candidates scored; {res.notes.length} merged as indistinguishable.</p>
            {res.next && !res.done && <p className="mf-muted">Next: {res.next.instruction}</p>}
            <h2>Provider trace</h2>
            <ul className="mf-list mf-trace">
              {res.trace.map((t, i) => <li key={i}>{t.step}: {t.provider}/{t.model ?? "-"} · {t.status} · {t.durationMs} ms</li>)}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
