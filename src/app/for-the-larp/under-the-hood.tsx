"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Brand } from "../../components/ohmni/brand";
import { CircuitView } from "../../components/ohmni/circuit-view";
import { solveDC } from "../../lib/circuit/solve";
import { validateGraph } from "../../lib/circuit/validate";
import { diagnose } from "../../lib/diagnosis";
import { probeStep, type Observation } from "../../lib/probe";
import type { CircuitGraph } from "../../lib/circuit/types";
import { buildMNA, expectedBits } from "./math";
import { EDGES, FIXTURES, LADDER_5V, PIPELINE, TRACES } from "./data";
import "./larp.css";

const fmtV = (v: number) => `${Math.abs(v) < 1e-9 ? 0 : +v.toPrecision(4)} V`;
const fmtA = (a: number) => (Math.abs(a) < 1e-3 ? `${+(a * 1e3).toPrecision(4)} mA` : `${+a.toPrecision(4)} A`);
const fmtCell = (v: number) => (v === 0 ? "0" : Math.abs(v) >= 0.01 ? `${+v.toPrecision(4)}` : v.toExponential(2));
const pct = (p: number) => (p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

const TYPE_SRC = `// src/lib/circuit/types.ts (canonical contract, docs/API_CONTRACT.md v1)
export type CircuitComponent = {
  id: string;
  kind: 'resistor' | 'dc_voltage';
  value: number; // SI units: ohm or volt
  positiveNode: string;
  negativeNode: string;
  sourceBoundingBox?: [number, number, number, number];
};
export type CircuitGraph = {
  schemaVersion: 1;
  components: CircuitComponent[];
  groundNode: 'GND';
  measureNode: string;
};`;

// Broken variants of whichever fixture is selected (same shapes as MALFORMED_* in src/lib/circuit/fixtures.ts).
function variant(g: CircuitGraph, v: string): unknown {
  if (v === "floating")
    return { ...g, components: [...g.components, { id: "R9", kind: "resistor", value: 100, positiveNode: "X", negativeNode: "Y" }] };
  if (v === "nognd") {
    const sw = (n: string) => (n === "GND" ? "G2" : n);
    return { ...g, components: g.components.map((c) => ({ ...c, positiveNode: sw(c.positiveNode), negativeNode: sw(c.negativeNode) })) };
  }
  return g;
}

// ---------- 1. Pipeline ----------
const POS: Record<string, [number, number]> = {
  groq: [20, 20],
  normalize: [230, 20],
  jev: [440, 20],
  fallback: [20, 180],
  mna: [230, 180],
  human: [440, 180],
  diag: [230, 340],
  tutor: [440, 340],
};
const W = 180;
const H = 70;

function edgePath(a: string, b: string) {
  const [ax, ay] = POS[a];
  const [bx, by] = POS[b];
  const ac = [ax + W / 2, ay + H / 2];
  const bc = [bx + W / 2, by + H / 2];
  // The fallback returns around the boxes, leaving Normalize unobscured.
  if (a === "fallback" && b === "normalize") return "M110 180 V125 H215 V55 H226";
  // exit/enter on the facing sides
  if (ay === by) {
    const dir = bx > ax ? 1 : -1;
    return `M${ac[0] + (dir * W) / 2},${ac[1]} L${bc[0] - (dir * W) / 2 - dir * 4},${bc[1]}`;
  }
  if (ax === bx) {
    const dir = by > ay ? 1 : -1;
    return `M${ac[0]},${ac[1] + (dir * H) / 2} L${bc[0]},${bc[1] - (dir * H) / 2 - dir * 4}`;
  }
  return `M${ax + W},${ay + H / 2 + (by > ay ? 20 : -20)} L${bx - 4},${by + H / 2}`;
}

/** Wrap a node subtitle to at most two lines of ~22 chars (no truncation). */
function subLines(sub: string): string[] {
  if (sub.length <= 22) return [sub];
  const i = sub.lastIndexOf(" ", 22);
  return i > 0 ? [sub.slice(0, i), sub.slice(i + 1)] : [sub];
}

function Pipeline() {
  const [sel, setSel] = useState("jev");
  const node = PIPELINE.find((p) => p.id === sel)!;
  return (
    <div className="ul-pipe">
      <svg viewBox="0 0 640 430" className="ul-pipeSvg" role="group" aria-label="Runtime pipeline. Select a stage for details.">
        <defs>
          <marker id="ul-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {EDGES.map(([a, b, style]) => (
          <path key={a + b} d={edgePath(a, b)} className={`ul-edge ${style === "dashed" ? "ul-edgeDash" : ""}`} markerEnd="url(#ul-arrow)" />
        ))}
        {EDGES.filter(([, b]) => b === sel).map(([a, b]) => <path key={`selected-${a}-${b}`} d={edgePath(a, b)} pathLength="1" className="ul-edge ul-edgeSelected" aria-hidden="true" />)}
        <text x={30} y={140} className="ul-edgeLabel">on failure</text>
        {PIPELINE.map((p) => {
          const [x, y] = POS[p.id];
          const on = p.id === sel;
          return (
            <g
              key={p.id}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-controls="ul-pipe-detail"
              aria-label={`${p.title}, ${p.sub}`}
              className={`ul-pnode ul-k-${p.kind} ${on ? "ul-pnodeOn" : ""}`}
              onClick={() => setSel(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSel(p.id);
                }
              }}
            >
              <rect x={x} y={y} width={W} height={H} rx={8} />
              <text x={x + 12} y={y + 28} className="ul-pTitle">
                {p.title}
              </text>
              <text x={x + 12} y={y + 48} className="ul-pSub">
                {subLines(p.sub).map((l, i) => (
                  <tspan key={i} x={x + 12} dy={i ? 13 : 0}>
                    {l}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      <div id="ul-pipe-detail" className="ul-card ul-detail" aria-live="polite">
        <p className="ul-eyebrow">
          {node.kind === "model" ? "MODEL CALL (server-only)" : node.kind === "human" ? "HUMAN GATE" : "DETERMINISTIC CODE"}
        </p>
        <h3>{node.title}</h3>
        <p className="ul-muted">{node.sub}</p>
        <dl className="ul-dl">
          <dt>Inputs</dt>
          <dd>{node.inputs}</dd>
          <dt>Outputs</dt>
          <dd>{node.outputs}</dd>
          <dt>Code</dt>
          <dd>
            {node.files.map((f) => (
              <code key={f} className="ul-file">
                {f}
              </code>
            ))}
          </dd>
          <dt>Failure behavior</dt>
          <dd>{node.failure}</dd>
        </dl>
      </div>
    </div>
  );
}

// ---------- 2. Traces ----------
function Traces() {
  const [k, setK] = useState(TRACES[0].key);
  const t = TRACES.find((x) => x.key === k)!;
  return (
    <>
      <div className="ul-picker" role="group" aria-label="Choose a recorded trace">
        {TRACES.map((x) => (
          <button key={x.key} type="button" aria-pressed={x.key === k} className={`ul-pick ${x.key === k ? "ul-pickOn" : ""}`} onClick={() => setK(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className={`ul-card ${t.historical ? "ul-hist" : ""}`}>
        <p className="ul-stamp">
          {t.historical ? "HISTORICAL · " : ""}RECORDED on {t.when}, build <code>{t.build}</code>
        </p>
        <p className="ul-muted">
          Input: <code>{t.input}</code>
        </p>
        <div className="ul-scroll">
          <table className="ul-table">
            <thead>
              <tr>
                <th scope="col">step</th>
                <th scope="col">provider / model</th>
                <th scope="col">status</th>
                <th scope="col">ms</th>
                <th scope="col">tokens in / out</th>
                <th scope="col">note</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <code>{r.step}</code>
                  </td>
                  <td>
                    {r.provider} / {r.model}
                  </td>
                  <td className={r.status === "ok" ? "ul-ok" : "ul-bad"}>{r.status}</td>
                  <td>{r.ms}</td>
                  <td>{r.tokens}</td>
                  <td>{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          <strong>Outcome:</strong> {t.outcome}
        </p>
        {t.extra && <p className="ul-muted">{t.extra}</p>}
        <p className="ul-source">Source: {t.source}</p>
      </div>
    </>
  );
}

// ---------- 3-5. Live math on the selected fixture ----------
function Matrix({ graph }: { graph: CircuitGraph }) {
  const [cell, setCell] = useState<[number, number]>([0, 0]);
  const m = useMemo(() => buildMNA(graph), [graph]);
  const s = useMemo(() => solveDC(graph), [graph]);
  const n = m.nodes.length;
  const cols = [...m.nodes.map((x) => `v(${x})`), ...m.sources.map((x) => `i(${x})`)];
  const rows = [...m.nodes.map((x) => `KCL @ ${x}`), ...m.sources.map((x) => `${x} equation`)];
  const block = (i: number, j: number) => (i < n ? (j < n ? "G" : "B") : j < n ? "C" : "D");
  const exact = m.nodes.every((x, i) => m.x[i] === s.voltages[x]);
  const stamp = (i: number, j: number) => {
    const a = m.nodes[i], b = m.nodes[j];
    const parts = graph.components.filter((c) => c.kind === "resistor" &&
      (i === j ? [c.positiveNode, c.negativeNode].includes(a) :
        [c.positiveNode, c.negativeNode].includes(a) && [c.positiveNode, c.negativeNode].includes(b)));
    return `G[${a}, ${b}] = ${parts.length ? parts.map((c) => `${i === j ? "" : "−"}1/${c.id}`).join(" + ") : "0"} S`;
  };
  const activeCell: [number, number] = [Math.min(cell[0], n - 1), Math.min(cell[1], n - 1)];
  return (
    <>
      <div className="ul-scroll">
        <table className="ul-matrix" aria-label="MNA system A x = b">
          <thead>
            <tr>
              <th scope="col" />
              {cols.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
              <th scope="col" className="ul-sep">
                b
              </th>
              <th scope="col" className="ul-sep">
                x (solved)
              </th>
            </tr>
          </thead>
          <tbody>
            {m.A.map((row, i) => (
              <tr key={i}>
                <th scope="row">{rows[i]}</th>
                {row.map((v, j) => (
                  <td key={j} className={`ul-b${block(i, j)}`} title={`${block(i, j)} block`}>
                    {i < n && j < n ? <button type="button" className="ul-matrix-cell" aria-label={`${stamp(i, j)}; value ${fmtCell(v)}`} aria-pressed={activeCell[0] === i && activeCell[1] === j} onFocus={() => setCell([i, j])} onMouseEnter={() => setCell([i, j])} onClick={() => setCell([i, j])}>{fmtCell(v)}</button> : fmtCell(v)}
                  </td>
                ))}
                <td className="ul-sep">{fmtCell(m.b[i])}</td>
                <td className="ul-sep">
                  <strong>{i < n ? fmtV(m.x[i]) : fmtA(m.x[i])}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ul-stamp-note" role="status">{stamp(...activeCell)}. Select a conductance cell to inspect its resistor contributions.</p>
      <p className="ul-legend">
        <span className="ul-bG">G</span> conductances (S) <span className="ul-bB">B</span>/<span className="ul-bC">C</span> source incidence{" "}
        <span className="ul-bD">D</span> zero for ideal sources. Source current follows MNA sign: current into the + terminal, so a source
        delivering power reads negative.
      </p>
      <p className={exact ? "ul-ok" : "ul-bad"}>
        {exact ? <CheckCircle2 size={15} aria-hidden /> : <XCircle size={15} aria-hidden />} solveDC() in this browser returns{" "}
        {m.nodes.map((x) => `${x} = ${fmtV(s.voltages[x])}`).join(", ")}: {exact ? "bit-for-bit identical" : "MISMATCH"} to the displayed x.
      </p>
    </>
  );
}

function Diagnose({ graph }: { graph: CircuitGraph }) {
  const expected = useMemo(() => solveDC(graph).voltages[graph.measureNode], [graph]);
  const vmax = Math.max(...graph.components.filter((c) => c.kind === "dc_voltage").map((c) => c.value));
  const [measured, setMeasured] = useState(() => +(expected * 0.18).toFixed(2));
  const hyps = useMemo(() => diagnose(graph, measured), [graph, measured]);
  return (
    <>
      <div className="ul-ev">
        <div className="ul-card ul-stat">
          <span className="ul-eyebrow">PREDICTION (solver)</span>
          <strong>{fmtV(expected)}</strong>
          <span className="ul-muted">at {graph.measureNode}</span>
        </div>
        <div className="ul-card ul-stat">
          <span className="ul-eyebrow">EVIDENCE (your meter)</span>
          <strong>{fmtV(measured)}</strong>
          <span className="ul-muted">Δ {fmtV(measured - expected)}</span>
        </div>
      </div>
      <label className="ul-slider">
        Measured voltage at {graph.measureNode}: <strong>{measured.toFixed(2)} V</strong>
        <input type="range" min={0} max={vmax} step={0.01} value={measured} onChange={(e) => setMeasured(Number(e.target.value))} />
      </label>
      <ol className="ul-hyps" aria-live="polite">
        {hyps.map((h) => (
          <li key={h.title} className="ul-card">
            <strong>{h.title}</strong>
            <p>{h.rationale}</p>
            <p className="ul-muted">Next: {h.nextMeasurement}</p>
          </li>
        ))}
        {hyps.length === 0 && <li className="ul-card">No single-fault hypothesis reproduces this reading.</li>}
      </ol>
    </>
  );
}

function Live() {
  const [fi, setFi] = useState(0);
  const [v, setV] = useState("ok");
  const fx = FIXTURES[fi];
  const shown = useMemo(() => variant(fx.graph, v), [fx, v]);
  const val = useMemo(() => validateGraph(shown), [shown]);
  return (
    <>
      <section className="ul-section" aria-labelledby="s3">
        <h2 id="s3">
          <span>3</span> Topology &amp; validation
        </h2>
        <p className="ul-lede">
          Models never hand the solver a picture. They hand it this typed graph, which <code>validateGraph</code> (zod schema + graph
          walk from GND) must accept before anything is solved. The checks below run in your browser.
        </p>
        <div className="ul-two">
          <pre className="ul-code" tabIndex={0} aria-label="CircuitGraph type">
            {TYPE_SRC}
          </pre>
          <div>
            <div className="ul-picker" role="group" aria-label="Choose a fixture">
              {FIXTURES.map((f, i) => (
                <button key={f.key} type="button" aria-pressed={i === fi} className={`ul-pick ${i === fi ? "ul-pickOn" : ""}`} onClick={() => setFi(i)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="ul-picker" role="group" aria-label="Choose a variant">
              {[
                ["ok", "As drawn"],
                ["floating", "Break: floating node"],
                ["nognd", "Break: missing GND"],
              ].map(([k, l]) => (
                <button key={k} type="button" aria-pressed={k === v} className={`ul-pick ul-pickSm ${k === v ? "ul-pickOn" : ""}`} onClick={() => setV(k)}>
                  {l}
                </button>
              ))}
            </div>
            <div className="ul-circuit">
              <CircuitView graph={shown as CircuitGraph} />
            </div>
            <div className={`ul-card ${val.ok ? "ul-valOk" : "ul-valBad"}`} aria-live="polite">
              {val.ok ? (
                <p className="ul-ok">
                  <CheckCircle2 size={15} aria-hidden /> validateGraph: ok ({fx.graph.components.length} components, measure{" "}
                  {fx.graph.measureNode})
                </p>
              ) : (
                <>
                  <p className="ul-bad">
                    <XCircle size={15} aria-hidden /> validateGraph rejected it. The solver is never called:
                  </p>
                  <ul>
                    {val.errors.map((e) => (
                      <li key={e}>
                        <code>{e}</code>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <details className="ul-json">
              <summary>Graph JSON</summary>
              <pre>{JSON.stringify(shown, null, 1)}</pre>
            </details>
          </div>
        </div>
      </section>

      <section className="ul-section" aria-labelledby="s4">
        <h2 id="s4">
          <span>4</span> MNA solver: the only math authority
        </h2>
        <p className="ul-lede">
          Modified Nodal Analysis stamps each resistor as a conductance into <em>G</em> and each ideal source as a row/column pair (
          <em>B</em>, <em>C</em>), then solves <code>[G B; C D]·[v; j] = [i; e]</code> by Gaussian elimination with partial pivoting.{" "}
          <code>solveDC</code> keeps its matrix private, so this page re-derives it with the same stamps (
          <code>src/app/for-the-larp/math.ts</code>) and checks the result against <code>solveDC</code> live; a unit test pins it.
          Fixture: <strong>{fx.label}</strong>.
        </p>
        {val.ok ? <Matrix graph={fx.graph} /> : <p className="ul-bad">Restore the graph (&quot;As drawn&quot;) above: an invalid graph is never solved.</p>}
      </section>

      <section className="ul-section" aria-labelledby="s5">
        <h2 id="s5">
          <span>5</span> Predictions &amp; evidence
        </h2>
        <p className="ul-lede">
          Drag the meter reading. <code>diagnose()</code> re-solves the circuit with each part open, shorted, off-value or each supply
          off-rail, and ranks single-fault hypotheses that reproduce your reading. No model, no network: everything below recomputes in
          your browser.
        </p>
        {val.ok ? <Diagnose key={fx.key} graph={fx.graph} /> : <p className="ul-bad">Restore the graph above first.</p>}
      </section>
    </>
  );
}

// ---------- 6. Probe Guide ----------
function Probe() {
  const [obs, setObs] = useState<Observation[]>([{ node: "B", volts: 0 }]);
  const step = useMemo(() => probeStep(LADDER_5V, obs), [obs]);
  const nodes = Object.keys(step.hypotheses[0]?.predicted ?? {}).filter((n) => n !== "GND" && !obs.some((o) => o.node === n));
  return (
    <div className="ul-two">
      <div>
        <div className="ul-circuit">
          <CircuitView graph={LADDER_5V} highlightedNode={step.next?.node} />
        </div>
        <p className="ul-muted">
          Ladder: V1 = 5 V, R1, R2, R3 = 10 kΩ in series. Expected B = 1.667 V. Readings:{" "}
          {obs.map((o) => `${o.node} = ${fmtV(o.volts)}`).join(", ")}.
        </p>
        <div className="ul-picker">
          {obs.length === 1 ? (
            <button type="button" className="ul-pick ul-pickOn" onClick={() => setObs([...obs, { node: "A", volts: 5 }])}>
              Enter A = 5 V
            </button>
          ) : (
            <button type="button" className="ul-pick" onClick={() => setObs([{ node: "B", volts: 0 }])}>
              Reset to B = 0 V
            </button>
          )}
        </div>
      </div>
      <div>
        {nodes.length > 0 && !step.done && (
          <table className="ul-table" aria-label="Expected information gain per node">
            <thead>
              <tr>
                <th scope="col">probe node</th>
                <th scope="col">expected gain</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => {
                const bits = expectedBits(step.hypotheses, n);
                return (
                  <tr key={n} className={step.next?.node === n ? "ul-rowOn" : ""}>
                    <td>
                      <strong>{n}</strong>
                    </td>
                    <td>
                      <span className="ul-bar" style={{ width: `${Math.max(2, (bits / Math.log2(16)) * 100)}%` }} /> {bits.toFixed(2)} bits
                    </td>
                    <td>{step.next?.node === n ? "← probeStep picks" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="ul-reason">
          <strong>{step.reason}</strong>
        </p>
        {step.next && (
          <ul className="ul-outs">
            {step.next.outcomes.map((o) => (
              <li key={o.volts}>
                ≈ {fmtV(o.volts)} → {pct(o.probability)}: {o.hypothesisIds.join(", ")}
              </li>
            ))}
          </ul>
        )}
        <h3 className="ul-h3">Posterior (top 5)</h3>
        <ul className="ul-post">
          {step.hypotheses.slice(0, 5).map((h) => (
            <li key={h.id}>
              <span>{h.title}</span>
              <strong>{pct(h.probability)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------- page ----------
const TOC = [
  ["s1", "Pipeline"],
  ["s2", "Recorded traces"],
  ["s3", "Topology"],
  ["s4", "MNA solver"],
  ["s5", "Predictions"],
  ["s6", "Probe Guide"],
  ["s7", "Economics"],
  ["s8", "Scope"],
];

export function UnderTheHood() {
  return (
    <div className="ohmni lab-page ul-page">
      <header className="site-header lab-header">
        <Brand />
        <nav aria-label="Under the Hood navigation">
          <Link href="/" className="back-link">
            <ArrowLeft size={15} aria-hidden /> Home
          </Link>
          <span className="workspace-tag">
            <span className="tiny-dot" /> UNDER THE HOOD
          </span>
        </nav>
      </header>
      <main className="ul-main">
        <div className="ul-hero">
          <p className="ul-eyebrow">UNDER THE HOOD</p>
          <h1>
            <span className="ul-larp">FOR THE LARP —</span> Every prediction has a provenance.
          </h1>
          <p>
            Model outputs on this page are <strong>recorded evidence</strong>, each stamped with its date and build SHA. Every number in
            sections 3 to 6 is <strong>computed live in your browser</strong> by the same code production runs. This page makes no model
            calls and holds no keys.
          </p>
          <nav aria-label="Sections" className="ul-toc">
            {TOC.map(([id, l], i) => (
              <a key={id} href={`#${id}`}>
                {i + 1}. {l}
              </a>
            ))}
          </nav>
        </div>

        <section className="ul-section" aria-labelledby="s1">
          <h2 id="s1">
            <span>1</span> The runtime pipeline
          </h2>
          <p className="ul-lede">
            Two vision models read pixels; one router reads text; a human confirms; deterministic code does all the math. Select a stage.
          </p>
          <Pipeline />
        </section>

        <section className="ul-section" aria-labelledby="s2">
          <h2 id="s2">
            <span>2</span> Recorded traces
          </h2>
          <p className="ul-lede">
            Real <code>trace</code> arrays returned by production, copied from the repo&apos;s evidence docs. Static data: replaying them
            here costs no quota.
          </p>
          <Traces />
        </section>

        <Live />

        <section className="ul-section" aria-labelledby="s6">
          <h2 id="s6">
            <span>6</span> Probe Guide: where to measure next
          </h2>
          <p className="ul-lede">
            <code>probeStep()</code> builds 1 nominal + 13 single-fault hypotheses (each resistor open, shorted, ×10, ×0.1; supply dead),
            re-solves each with MNA, and weights them by a Gaussian meter model (σ = 2% + 10 mV). For each unmeasured node it groups
            hypotheses whose predicted readings a meter can&apos;t tell apart and computes expected information gain{" "}
            <code>IG = H(posterior) − Σ P(outcome)·H(posterior | outcome)</code> in bits. Highest gain wins. Computed live below.
          </p>
          <Probe />
        </section>

        <section className="ul-section" aria-labelledby="s7">
          <h2 id="s7">
            <span>7</span> Usage, latency, limits &amp; economics
          </h2>
          <p className="ul-lede">
            Measured anecdotes, not distributions. Unknown is written as unknown, never as $0. Sources: docs/UNIT_ECONOMICS.md,
            docs/MODEL_ACCESS.md, docs/VISION_FALLBACK.md, docs/demo/README.md.
          </p>
          <h3 className="ul-h3">Measured (2026-10-11, production)</h3>
          <div className="ul-scroll">
            <table className="ul-table">
              <thead>
                <tr>
                  <th scope="col">stage</th>
                  <th scope="col">model</th>
                  <th scope="col">latency</th>
                  <th scope="col">tokens in / out</th>
                  <th scope="col">source</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Extract (current primary)</td>
                  <td>qwen/qwen3.8-27b (Groq)</td>
                  <td>839 ms</td>
                  <td>1208 / 211</td>
                  <td>clear divider, 12:51 PDT, d1096b7 (docs/demo/README.md)</td>
                </tr>
                <tr>
                  <td>Extract, 10 synthetic fixtures</td>
                  <td>qwen/qwen3.8-27b (Groq)</td>
                  <td>735 ms median</td>
                  <td>1208 / 233</td>
                  <td>10/10 exact, 0 API errors; not a benchmark (docs/VISION_FALLBACK.md)</td>
                </tr>
                <tr>
                  <td>Extract (fallback)</td>
                  <td>gemini-3.5-flash-lite</td>
                  <td>1140 ms</td>
                  <td>1310 / 229</td>
                  <td>12:52 PDT, d1096b7 (docs/demo/README.md)</td>
                </tr>
                <tr>
                  <td>Extract (Gemini-primary era)</td>
                  <td>gemini-3.5-flash</td>
                  <td>3790 ms</td>
                  <td>1310 / 106</td>
                  <td>docs/UNIT_ECONOMICS.md</td>
                </tr>
                <tr>
                  <td>Route</td>
                  <td>jev-1.13-free (BeatAPI)</td>
                  <td>440 ms</td>
                  <td>475 / 49</td>
                  <td>same Gemini-era run (docs/UNIT_ECONOMICS.md)</td>
                </tr>
                <tr>
                  <td>Solve</td>
                  <td>local MNA</td>
                  <td>~1 ms</td>
                  <td>n/a</td>
                  <td>docs/UNIT_ECONOMICS.md</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3 className="ul-h3">Free-plan ceilings and listed prices (accessed 2026-10-11)</h3>
          <div className="ul-scroll">
            <table className="ul-table">
              <thead>
                <tr>
                  <th scope="col">provider</th>
                  <th scope="col">free-plan limit</th>
                  <th scope="col">paid price</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Jev jev-1.13-free (BeatAPI)</td>
                  <td>
                    <strong>1 successful call/min</strong> before any top-up (binding: 1 analysis/min)
                  </td>
                  <td>jev-1.13: $0.042 / 1M input, output free; refused in code</td>
                </tr>
                <tr>
                  <td>Groq qwen/qwen3.8-27b</td>
                  <td>30 RPM, 1K RPD, 8K TPM, 200K TPD; ~2.5k tokens per image call ⇒ ~3 extractions/min</td>
                  <td>not listed (groq.com/pricing)</td>
                </tr>
                <tr>
                  <td>Gemini (fallback + tutor)</td>
                  <td>not listed (AI Studio only); free quota observed exhausted (429) on 2026-10-11</td>
                  <td>gemini-3.5-flash: not listed</td>
                </tr>
                <tr>
                  <td>App guard (src/proxy.ts)</td>
                  <td>per IP: extract 6/min + 40/h, solve 60/min, explain 10/min</td>
                  <td>n/a</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="ul-muted">
            Usage charges in this deployment: $0 by construction (free plans), which is <strong>not</strong> a production marginal-cost
            claim. Hypothetical paid cost per analysis (<code>scripts/cost-model.mjs</code>): Jev $0.0000200; Groq and Gemini unknown until
            their prices are listed, so the total is <strong>incomplete</strong>. No routing-savings claim: there is no same-case baseline yet.
          </p>
        </section>

        <section className="ul-section" aria-labelledby="s8">
          <h2 id="s8">
            <span>8</span> Supported today vs planned
          </h2>
          <div className="ul-two">
            <div className="ul-card ul-valOk">
              <h3>Works today</h3>
              <ul>
                <li>DC resistive networks: resistors + ideal DC voltage sources</li>
                <li>Clean schematic images (synthetic renders; real-photo accuracy unmeasured)</li>
                <li>Single-fault hypotheses: open, short, off-value resistor, off-rail supply</li>
                <li>Probe Guide (information gain) and solver-grounded tutor</li>
                <li>Routes review_extraction and ask_user observed on the Groq-primary pipeline</li>
              </ul>
            </div>
            <div className="ul-card ul-plan">
              <h3>Planned / research (not shipped)</h3>
              <ul>
                <li>
                  Topology confidence engine: research,{" "}
                  <a href="https://github.com/dude297/Ohmni/pull/39">PR #39</a> (open, not merged)
                </li>
                <li>verify_topology on the Groq-primary stack: implemented, not yet observed live</li>
                <li>Breadboard and netlist adapters: planned</li>
                <li>Capacitors, inductors, AC and transient analysis: research</li>
                <li>PCB/EDA imports: exploration</li>
                <li>Multiple simultaneous faults: not modeled (a fit warning says so)</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
