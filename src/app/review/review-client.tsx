"use client";

import Link from "next/link";
import { useState } from "react";
import { DIVIDER_10K_10K, LOADED_BRIDGE_12V } from "../../lib/circuit/fixtures";
import { REVIEW_DISCLAIMER } from "../../lib/review/disclaimer";
import type { Finding } from "../../lib/review/rules";
import type { ModelTraceEvent } from "../../lib/circuit/types";
import "./review.css";

const SAMPLES = {
  divider: { label: "Divider 10k / 10k (5 V)", graph: DIVIDER_10K_10K },
  bridge: { label: "Loaded bridge 12 V", graph: LOADED_BRIDGE_12V },
};
type Key = keyof typeof SAMPLES;
type Mentor = { text: string; grounded: boolean; ungroundedNumbers: string[]; trace: ModelTraceEvent[] };
type Result = { advisory: boolean; disclaimer: string; findings: Finding[]; mentor?: Mentor; trace: ModelTraceEvent[] };

async function call(body: unknown): Promise<Result> {
  const res = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  if (res.status === 429) throw new Error(`Rate limit reached. Wait ${res.headers.get("retry-after") ?? "a minute"}s and try again.`);
  if (!res.ok) throw new Error(j?.error?.message ?? `Request failed (${res.status})`);
  return j.result;
}

export function ReviewClient() {
  const [key, setKey] = useState<Key>("divider");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [mentors, setMentors] = useState<Record<string, Mentor>>({});

  const run = async () => {
    setBusy("review"); setError(null); setMentors({});
    try { setResult(await call({ graph: SAMPLES[key].graph, userConfirmed: confirmed })); }
    catch (e) { setError((e as Error).message); setResult(null); }
    setBusy(null);
  };
  const ask = async (f: Finding) => {
    setBusy(f.id); setError(null);
    try {
      const r = await call({ graph: SAMPLES[key].graph, userConfirmed: confirmed, mentor: { findingId: f.id, level: "beginner", mode: "explain" } });
      if (r.mentor) setMentors((m) => ({ ...m, [f.id]: r.mentor! }));
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  };

  const trace = [...(result?.trace ?? []), ...Object.values(mentors).flatMap((m) => m.trace)];

  return (
    <>
      <header className="rv-head">
        <Link href="/" className="rv-link">Ohmni home</Link>
        <Link href="/tracks" className="rv-link">Workspaces</Link>
      </header>
      <main className="rv-main">
        <h1>Schematic review</h1>
        <p className="rv-banner" role="note"><strong>Advisory only.</strong> {result?.disclaimer ?? REVIEW_DISCLAIMER}</p>
        <p className="rv-muted">Samples are fixtures, not uploads. Resistors and DC sources only.</p>

        <div className="rv-card">
          <label htmlFor="rv-sample">Sample circuit</label>
          <select id="rv-sample" value={key} onChange={(e) => { setKey(e.target.value as Key); setResult(null); setMentors({}); }}>
            {Object.entries(SAMPLES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
          <label className="rv-check" htmlFor="rv-confirm">
            <input id="rv-confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I confirm this circuit
          </label>
          <button className="rv-btn" onClick={run} disabled={!confirmed || busy !== null}>{busy === "review" ? "Reviewing..." : "Run review"}</button>
          <p className="rv-muted">Running the review uses the local rules and solver only. No AI call.</p>
        </div>

        {error && <p className="rv-error" role="alert">{error}</p>}

        {result && (
          <section aria-label="Findings">
            <h2>Findings ({result.findings.length})</h2>
            <ul className="rv-list">
              {result.findings.map((f) => {
                const m = mentors[f.id];
                return (
                  <li key={f.id} className={`rv-find rv-sev-${f.severity}`}>
                    <span className="rv-sev">{f.severity}</span> <span className="rv-cat">{f.category} · {f.basis}</span>
                    <p>{f.evidence.statement}</p>
                    {m ? (
                      <div className="rv-mentor">
                        <p>{m.text}</p>
                        <p className={m.grounded ? "rv-ok" : "rv-warn"}>
                          {m.grounded ? "Grounded: every number matches the solver evidence." : `Ungrounded numbers: ${m.ungroundedNumbers.join(", ")}`}
                        </p>
                      </div>
                    ) : (
                      <button className="rv-btn rv-ghost" onClick={() => ask(f)} disabled={busy !== null}>
                        {busy === f.id ? "Asking..." : "Explain with AI (uses model quota)"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <h2>Provider trace</h2>
            <ul className="rv-list rv-trace">
              {trace.map((t, i) => (
                <li key={i}>{t.step}: {t.provider}/{t.model ?? "-"} · {t.status} · {t.durationMs} ms{t.note ? ` · ${t.note}` : ""}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
