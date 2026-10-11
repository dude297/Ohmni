"use client";
import Link from "next/link";
import { useState } from "react";
import { R1, R2_MAX, R2_MIN, VIN, canShowHint, dividerGraph, errorPct, formulaVout, hintText, r2InRange, substitution } from "./lesson";
import "./learn.css";

type Attempt = { r2: number; predicted: number; solver: number; err: number };

export function LearnClient() {
  const [r2, setR2] = useState(10000);
  const [pred, setPred] = useState("");
  const [hints, setHints] = useState(0);
  const [result, setResult] = useState<Attempt | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const p = Number(pred);
  const canReveal = pred.trim() !== "" && Number.isFinite(p) && r2InRange(r2) && !busy;

  async function reveal() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph: dividerGraph(r2), userConfirmed: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Solver request failed");
      const solver = json.result.voltages.VOUT as number;
      if (typeof solver !== "number") throw new Error("Solver returned no VOUT");
      const a = { r2, predicted: p, solver, err: errorPct(p, solver) };
      setResult(a);
      setAttempts((x) => [...x, a]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Solver request failed");
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setResult(null);
    setPred("");
    setHints(0);
  }

  const locked = result !== null;
  return (
    <div className="ln-shell">
      <header className="ln-top"><Link href="/tracks">&larr; Workspaces</Link><span>Ohmni Learn</span></header>
      <main className="ln-main">
        <h1>Predict first. Then see the solver.</h1>
        <svg className="ln-art" viewBox="0 0 320 120" role="img" aria-label="Voltage divider: 5 V source, R1 10 kilohm, R2 variable, VOUT node">
          <g fill="none" stroke="#829E98" strokeWidth="2.5"><path d="M20 20H80l10-10 10 20 10-20 10 20 10-10h40M200 20h40M240 20V45M240 75V105H20V20" /><rect x="230" y="45" width="20" height="30" stroke="#F2B45A" /></g>
          <circle cx="200" cy="20" r="5" fill="#F2B45A" />
          <text x="26" y="52" fontFamily="monospace" fontSize="13" fill="#142C32">{VIN} V</text>
          <text x="90" y="46" fontFamily="monospace" fontSize="12" fill="#142C32">R1 {R1 / 1000}k</text>
          <text x="256" y="64" fontFamily="monospace" fontSize="12" fill="#142C32">R2 {r2} Ω</text>
          <text x="170" y="12" fontFamily="monospace" fontSize="12" fill="#943E2C">VOUT = ?</text>
        </svg>

        <section className="ln-card">
          <h2>1. Choose R2</h2>
          <label>R2 (Ω), supported {R2_MIN}–{R2_MAX}
            <input type="range" min={R2_MIN} max={R2_MAX} step={100} value={r2} disabled={locked} onChange={(e) => setR2(Number(e.target.value))} aria-label="R2 slider" />
          </label>
          <input type="number" value={r2} min={R2_MIN} max={R2_MAX} disabled={locked} onChange={(e) => setR2(Number(e.target.value))} aria-label="R2 value in ohms" />
          {!r2InRange(r2) && <p className="ln-err">R2 must be between {R2_MIN} and {R2_MAX} Ω.</p>}
        </section>

        <section className="ln-card">
          <h2>2. Predict VOUT (volts)</h2>
          <input type="number" step="any" placeholder="e.g. 2.5" value={pred} disabled={locked} onChange={(e) => setPred(e.target.value)} aria-label="Predicted VOUT" />
          <div className="ln-hints">
            {[1, 2, 3].map((n) => (
              <div key={n}>
                {n <= hints ? <p className="ln-hint"><b>Hint {n}.</b> {hintText(n as 1 | 2 | 3, r2)}</p>
                  : <button disabled={!canShowHint(n, hints, locked)} onClick={() => setHints(n)}>Hint {n}</button>}
              </div>
            ))}
          </div>
          <button className="ln-go" disabled={!canReveal || locked} onClick={reveal}>{busy ? "Solving…" : "Reveal solver result"}</button>
          {error && <p className="ln-err" role="alert">{error}</p>}
        </section>

        {result && (
          <section className="ln-card" data-testid="reveal">
            <h2>3. Result</h2>
            <table className="ln-table"><tbody>
              <tr><th>YOUR PREDICTION</th><td>{result.predicted.toFixed(4)} V</td></tr>
              <tr><th>SIMULATED (solver)</th><td data-testid="solver-vout">{result.solver.toFixed(4)} V</td></tr>
              <tr><th>MEASURED</th><td>not measured: no hardware in this lesson</td></tr>
              <tr><th>Error</th><td>{result.err.toFixed(2)} %</td></tr>
            </tbody></table>
            <p className="ln-formula">{substitution(result.r2)}</p>
            <p className="ln-note">Formula check vs solver: {Math.abs(formulaVout(result.r2) - result.solver) < 1e-9 ? "equal within 1e-9" : "MISMATCH"}.</p>
            <button className="ln-go" onClick={again}>Try another R2</button>
          </section>
        )}

        <section className="ln-card">
          <h2>Session summary</h2>
          <p className="ln-note">Kept in memory only; refreshing the page clears it.</p>
          {attempts.length === 0 ? <p>No attempts yet.</p> : (
            <ul>{attempts.map((a, i) => <li key={i}>R2 {a.r2} Ω: predicted {a.predicted.toFixed(3)} V, solver {a.solver.toFixed(3)} V, {a.err.toFixed(1)} % off</li>)}</ul>
          )}
        </section>
      </main>
    </div>
  );
}
