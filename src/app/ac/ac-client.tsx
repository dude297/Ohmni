"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS, type AcGraph, type AcResult, type MeasuredPoint } from "../../lib/ac/types";
import { Bode, type PlotCurve } from "./bode";
import "./ac.css";

const src = { id: "V1", kind: "ac_source", amplitude: 1, a: "in", b: "GND" } as const;
type Comp = AcGraph["components"][number];
const PRESETS: Record<string, { name: string; sub: string; components: Comp[]; out: string }> = {
  rc: {
    name: "RC low-pass",
    sub: "fc = 159 Hz",
    out: "out",
    components: [src, { id: "R1", kind: "resistor", value: 1e3, a: "in", b: "out" }, { id: "C1", kind: "capacitor", value: 1e-6, a: "out", b: "GND" }],
  },
  rlc: {
    name: "RLC band-pass",
    sub: "f0 = 1.59 kHz, Q = 1",
    out: "out",
    components: [
      src,
      { id: "L1", kind: "inductor", value: 10e-3, a: "in", b: "m" },
      { id: "C1", kind: "capacitor", value: 1e-6, a: "m", b: "out" },
      { id: "R1", kind: "resistor", value: 100, a: "out", b: "GND" },
    ],
  },
  cr: {
    name: "CR high-pass",
    sub: "fc = 159 Hz",
    out: "out",
    components: [src, { id: "C1", kind: "capacitor", value: 1e-6, a: "in", b: "out" }, { id: "R1", kind: "resistor", value: 1e3, a: "out", b: "GND" }],
  },
};

// Example bench readings of an RC board whose C1 is really 100 nF (not 1 uF): -3 dB near 1.59 kHz.
const EXAMPLE = "100, -0.02\n300, -0.17\n800, -1.05\n1590, -3.06\n3000, -6.5\n8000, -14.2\n20000, -22.0";

const si = (x: number, u: string) => {
  const t: [number, string][] = [[1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  const [m, p] = t.find(([m]) => Math.abs(x) >= m * 0.9999) ?? t[t.length - 1];
  return `${Number((x / m).toPrecision(3))} ${p}${u}`;
};
const UNIT = { resistor: "Ω", capacitor: "F", inductor: "H" } as const;
const parsePoints = (t: string): MeasuredPoint[] =>
  t.split("\n").flatMap((l) => {
    const [f, d] = l.split(/[,;\s]+/).map(Number);
    return Number.isFinite(f) && Number.isFinite(d) && l.trim() && f >= 1 && f <= 1e7 ? [{ freqHz: f, magDb: d }] : [];
  });

export function AcClient() {
  const [preset, setPreset] = useState("rc");
  const [values, setValues] = useState<Record<string, number>>({});
  const [text, setText] = useState("");
  const [diagnose, setDiagnose] = useState(false);
  const [res, setRes] = useState<AcResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const base = PRESETS[preset];
  const graphOf = useCallback(
    (v: Record<string, number>): AcGraph => ({
      schemaVersion: 2,
      groundNode: "GND",
      outputNode: base.out,
      components: base.components.map((c) => (c.kind === "ac_source" ? c : { ...c, value: v[c.id] ?? c.value })),
    }),
    [base],
  );

  const run = useCallback(
    async (v: Record<string, number>, faults: boolean, pts: MeasuredPoint[]) => {
      const me = ++seq.current;
      setBusy(true);
      setError("");
      try {
        const r = await fetch("/api/ac", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ graph: graphOf(v), userConfirmed: true, ...(faults && pts.length && { faults: true, measuredPoints: pts }) }),
        });
        const j = await r.json();
        if (me !== seq.current) return;
        if (!r.ok) throw new Error(j?.error?.message ?? `HTTP ${r.status}`);
        setRes(j.result);
      } catch (e) {
        if (me === seq.current) setError(e instanceof Error ? e.message : "Simulation failed");
      } finally {
        if (me === seq.current) setBusy(false);
      }
    },
    [graphOf],
  );

  const schedule = (v: Record<string, number>, faults = diagnose, pts = parsePoints(text)) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(v, faults, pts), 150);
  };

  useEffect(() => {
    const id = setTimeout(() => run({}, false, []), 0);
    return () => clearTimeout(id);
  }, [preset, run]);

  const pick = (k: string) => {
    setPreset(k);
    setValues({});
    setDiagnose(false);
    setText("");
    setShown({});
  };
  const pts = parsePoints(text);
  const toggleDiagnose = (on: boolean, t = text) => {
    setDiagnose(on);
    if (!on) setShown({});
    schedule(values, on, parsePoints(t));
  };

  const curves: PlotCurve[] = res
    ? [
        { id: "nom", label: "SIMULATED", cls: "ac-c0", freq: res.nominal.freq, mag: res.nominal.magDb, phase: res.nominal.phaseDeg },
        ...(res.candidates ?? [])
          .map((c, i) => ({ id: c.id, label: `SIMULATED ${c.title}`, cls: `ac-c${i + 1}`, freq: c.freq, mag: c.magDb, phase: c.phaseDeg }))
          .filter((c) => shown[c.id] !== false),
      ]
    : [];
  const t = res?.trace[0];

  return (
    <main className="ac-main">
      <header className="ac-head">
        <Link href="/" className="ac-back">← Ohmni</Link>
        <h1>AC Bode lab</h1>
        <span className="ac-engine">{t ? `ngspice · ${t.durationMs} ms` : busy ? "starting engine…" : ""}</span>
      </header>

      <div className="ac-presets" role="tablist" aria-label="Circuit presets">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} role="tab" aria-selected={k === preset} className={`ac-pick ${k === preset ? "ac-on" : ""}`} onClick={() => pick(k)}>
            <b>{p.name}</b>
            <small>{p.sub}</small>
          </button>
        ))}
      </div>

      <div className="ac-grid2">
        <section className="ac-card ac-plot" aria-busy={busy}>
          {curves.length ? <Bode curves={curves} measured={pts} /> : <div className="ac-empty">{error || "Running ngspice…"}</div>}
          {error && curves.length > 0 && <p className="ac-err" role="alert">{error}</p>}
          <ul className="ac-legend">
            <li className="ac-c0"><i /> SIMULATED (ngspice)</li>
            {pts.length > 0 && <li><i className="ac-mdot" /> MEASURED (your points)</li>}
          </ul>
        </section>

        <aside className="ac-side">
          <section className="ac-card">
            <h2>Components</h2>
            {base.components.map((c) => {
              if (c.kind === "ac_source") return null;
              const [lo, hi] = LIMITS.range[c.kind];
              const a = Math.max(lo, c.value / 100), b = Math.min(hi, c.value * 100);
              const v = values[c.id] ?? c.value;
              const pos = (Math.log(v / a) / Math.log(b / a)) * 1000;
              const set = (p: number) => ({ ...values, [c.id]: a * (b / a) ** (p / 1000) });
              return (
                <label key={c.id} className="ac-slider">
                  <span><b>{c.id}</b> {si(v, UNIT[c.kind])}</span>
                  <input
                    type="range" min={0} max={1000} value={pos}
                    aria-label={`${c.id} value`}
                    onChange={(e) => setValues(set(+e.target.value))}
                    onPointerUp={() => schedule(values)}
                    onKeyUp={() => schedule(values)}
                  />
                </label>
              );
            })}
          </section>

          {preset === "rc" && (
            <section className="ac-card">
              <h2>Fault finder</h2>
              <label className="ac-lbl" htmlFor="ac-meas">MEASURED points: Hz, dB per line</label>
              <textarea id="ac-meas" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"1590, -3.0"} />
              <div className="ac-row">
                <button className="ac-btn" onClick={() => { setText(EXAMPLE); }}>Load example (C1 = 100 nF)</button>
                <button className="ac-btn ac-primary" disabled={!pts.length} onClick={() => toggleDiagnose(true)}>Find fault</button>
                {diagnose && <button className="ac-btn" onClick={() => toggleDiagnose(false)}>Clear</button>}
              </div>
              {diagnose && res?.candidates && (
                <ul className="ac-cands">
                  {res.candidates.map((c, i) => (
                    <li key={c.id} className={`ac-c${i + 1}`}>
                      <label>
                        <input type="checkbox" checked={shown[c.id] !== false} onChange={(e) => setShown({ ...shown, [c.id]: e.target.checked })} />
                        <i /> {c.title} <small>{c.fitError?.toFixed(2)} dB rms</small>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>

      {diagnose && res?.discriminator && (
        <section className="ac-card ac-disc" aria-label="Discriminating measurement">
          <h2>Magnitude alone can&apos;t decide. Measure this next.</h2>
          <p>{res.discriminator.instruction}</p>
          <div className="ac-preds">
            {res.discriminator.predictions.map((p) => (
              <div key={p.candidateId}>
                <small>if {p.candidateId}</small>
                <b>{si(p.value, p.unit)}</b>
              </div>
            ))}
          </div>
          {res.discriminator.alternative && (
            <p className="ac-alt">
              {res.discriminator.alternative.instruction}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
