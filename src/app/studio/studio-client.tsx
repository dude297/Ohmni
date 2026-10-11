"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Component, useEffect, useMemo, useReducer, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Brand } from "../../components/ohmni/brand";
import { solveDC } from "../../lib/circuit/solve";
import { resistorBands } from "./_bands";
import { CORRECT_PRESET, INTENDED, MISTAKE_PRESET } from "./_examples";
import type { View } from "./_geometry";
import { diffAgainstIntended, netHoles as netHolesOf, nodeNameOfHole, toCircuitGraph } from "./_model";
import { initState, selectedHoles, studioReducer } from "./_state";
import { fmtOhm, fmtV, useReducedMotion } from "./_view";
import { Board2D } from "./board2d";
import { Schematic } from "./schematic";
import "./studio.css";

const Scene3D = dynamic(() => import("./scene3d"), { ssr: false, loading: () => <div className="st-hint" style={{ padding: 16 }}>Loading 3D board…</div> });

class Boundary extends Component<{ onError: () => void; children: ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() {
    return { bad: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.bad ? null : this.props.children;
  }
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const INTENDED_V = solveDC(INTENDED).voltages; // local deterministic solve of the intended schematic

export function StudioClient() {
  const [state, dispatch] = useReducer(studioReducer, undefined, () => initState(MISTAKE_PRESET()));
  const reduced = useReducedMotion();
  const gl = useSyncExternalStore(() => () => {}, hasWebGL, () => null as boolean | null);
  const [choice, setMode] = useState<null | "3d" | "2d">(null);
  const [failed, setFailed] = useState(false);
  const mode = failed ? "2d" : (choice ?? (gl === null ? null : gl ? "3d" : "2d"));
  const mode2dReason = failed ? "The 3D view failed to start, showing the 2D top view." : gl === false ? "WebGL is unavailable, showing the 2D top view." : "";
  const [view, setView] = useState<{ name: View; nonce: number }>({ name: "iso", nonce: 0 });

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && dispatch({ type: "cancelTool" });
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const { build, selection: sel, tool, solve } = state;
  const built = useMemo(() => toCircuitGraph(build), [build]);
  const diff = useMemo(() => diffAgainstIntended(INTENDED, build), [build]);
  const netHoles = useMemo(() => selectedHoles(state), [state]);
  const faultHoles = useMemo(() => [...new Set(diff.connectionDiffs.flatMap((d) => d.holes))], [diff]);

  // Solve the BUILT graph only after the explicit confirmation checkbox. Late results for old revisions are dropped in the reducer.
  const graph = built.graph;
  useEffect(() => {
    if (!state.confirmed || solve.status !== "idle" || !graph) return;
    const rev = state.revision;
    dispatch({ type: "solveStart", rev });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    fetch("/api/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph, userConfirmed: true }), signal: ctl.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !body?.result) throw new Error(body?.error?.message ?? `solve failed (${r.status})`);
        dispatch({ type: "solveDone", rev, voltages: body.result.voltages, currents: body.result.currents });
      })
      .catch((e: Error) => dispatch({ type: "solveFail", rev, error: e.name === "AbortError" ? "solver timed out" : e.message }))
      .finally(() => clearTimeout(t));
    return () => clearTimeout(t);
  }, [state.confirmed, state.revision, solve.status, graph]);

  const solved = solve.status === "ok" && solve.rev === state.revision ? solve : null;
  const measure = graph?.measureNode ?? "VOUT";
  const builtV = solved?.voltages;
  const boardProps = { state, dispatch, netHoles, faultHoles, reduced, view };
  const identical = diff.identical;

  const pinsIn = (holes: string[]) => {
    const set = new Set(holes);
    return [
      ...build.placements.flatMap((p) => (["positive", "negative"] as const).filter((t) => set.has(p.pins[t])).map((t) => `${p.id}.${t} (${p.pins[t]})`)),
      ...build.jumpers.flatMap((j) => (["a", "b"] as const).filter((e) => set.has(j[e])).map((e) => `${j.id}.${e.toUpperCase()} (${j[e]})`)),
    ];
  };
  const netLabel = (h: string) => nodeNameOfHole(build, h) ?? "unconnected";

  let inspector: ReactNode = <p className="st-hint">Click a part, hole, jumper or schematic node. Holes highlight their whole net (strips + jumpers).</p>;
  if (sel?.kind === "component") {
    const p = build.placements.find((x) => x.id === sel.id);
    const b = p && p.kind === "resistor" ? resistorBands(p.value) : null;
    if (p)
      inspector = (
        <div className="st-kv">
          <strong>{p.id} · {p.kind === "resistor" ? `resistor ${fmtOhm(p.value)}` : `supply ${p.value} V`}</strong>
          {b && <span>Bands: {b.names.join(", ")}</span>}
          <span>+ pin <code>{p.pins.positive}</code> on net <code>{netLabel(p.pins.positive)}</code></span>
          <span>− pin <code>{p.pins.negative}</code> on net <code>{netLabel(p.pins.negative)}</code></span>
          {solved?.currents && p.id in solved.currents && <span>Current {(solved.currents[p.id] * 1000).toFixed(3)} mA, + to − (from /api/solve)</span>}
        </div>
      );
  } else if (sel?.kind === "hole") {
    const hs = netHolesOf(build, sel.id);
    inspector = (
      <div className="st-kv">
        <strong>Hole {sel.id} · net {netLabel(sel.id)}</strong>
        <span>{hs.length} holes on this net</span>
        <span>Connected pins: {pinsIn(hs).join(", ") || "none"}</span>
      </div>
    );
  } else if (sel?.kind === "jumper") {
    const j = build.jumpers.find((x) => x.id === sel.id);
    if (j)
      inspector = (
        <div className="st-kv">
          <strong>Jumper {j.id}</strong>
          <span>End A <code>{j.a}</code> on net <code>{netLabel(j.a)}</code></span>
          <span>End B <code>{j.b}</code> on net <code>{netLabel(j.b)}</code></span>
          <span>Joins {netLabel(j.a) === netLabel(j.b) ? "one net to itself (redundant)" : `${netLabel(j.a)} and ${netLabel(j.b)}`}</span>
          <div className="st-bar" style={{ margin: "6px 0 0" }}>
            <button className="st-btn" data-testid="move-a" onClick={() => dispatch({ type: "beginMove", jumperId: j.id, end: "a" })}>Move end A</button>
            <button className="st-btn" data-testid="move-b" onClick={() => dispatch({ type: "beginMove", jumperId: j.id, end: "b" })}>Move end B</button>
            <button className="st-btn st-btnDanger" data-testid="delete-jumper" onClick={() => dispatch({ type: "deleteJumper", id: j.id })}>Delete</button>
          </div>
        </div>
      );
  } else if (sel?.kind === "node") {
    inspector = (
      <div className="st-kv">
        <strong>Node {sel.name}</strong>
        <span>Intended (local solve): <code>{fmtV(INTENDED_V[sel.name])}</code></span>
        <span>Built (/api/solve): <code>{builtV && sel.name in builtV ? fmtV(builtV[sel.name]) : "confirm the build to solve it"}</code></span>
        <span>{netHoles.length} holes on this net</span>
      </div>
    );
  }

  const nodeRows = builtV ? Object.keys(builtV).sort() : [];
  const toolMsg =
    tool.kind === "move" ? `Click a target hole for ${tool.jumperId} end ${tool.end.toUpperCase()}.` : tool.kind === "add" ? (tool.first ? `Click the second hole (first: ${tool.first}).` : "Click the first hole of the new jumper.") : null;

  return (
    <div className="ohmni lab-page st-root">
      <header className="site-header lab-header">
        <Brand />
        <nav aria-label="Studio navigation">
          <Link href="/lab" className="back-link">
            <ArrowLeft size={15} /> Back to workspace
          </Link>
          <span className="workspace-tag">
            <span className="tiny-dot" /> 3D STUDIO
          </span>
        </nav>
      </header>
      <main className="st-main">
        <div className="st-title">
          <h1>Circuit Studio</h1>
          <p>Intended schematic on the left, your breadboard build on the right. Nets come from strips and explicit jumper ends only, so a jumper one column off shows up as a split net. Edit the wiring and the diff recomputes instantly.</p>
        </div>
        <div className="st-bar" role="toolbar" aria-label="Example builds">
          <span className="st-badge">5 V DIVIDER</span>
          <button className="st-btn" data-testid="load-mistake" onClick={() => dispatch({ type: "load", build: MISTAKE_PRESET() })}>Load build with a wiring mistake</button>
          <button className="st-btn" data-testid="load-correct" onClick={() => dispatch({ type: "load", build: CORRECT_PRESET() })}>Load correct build</button>
        </div>

        <div className="st-grid">
          <section className="st-card" aria-label="Intended schematic">
            <h2>Intended schematic</h2>
            <Schematic selection={sel} dispatch={dispatch} diffs={diff.connectionDiffs} intended={INTENDED_V} values={solved && builtV ? { [measure]: builtV[measure] } : {}} builtCurrents={solved?.currents} />
            <p className="st-hint">Voltages on the schematic come from the local deterministic solver on the intended graph (SIMULATED).</p>
          </section>

          <section className="st-card" aria-label="Breadboard build">
            <h2>
              <span>Breadboard build · rev {state.revision}</span>
              <span className="st-bar" style={{ margin: 0 }}>
                <button className={`st-btn ${mode === "3d" ? "st-btnOn" : ""}`} aria-pressed={mode === "3d"} data-testid="mode-3d" onClick={() => setMode("3d")}>3D</button>
                <button className={`st-btn ${mode === "2d" ? "st-btnOn" : ""}`} aria-pressed={mode === "2d"} data-testid="mode-2d" onClick={() => setMode("2d")}>2D</button>
              </span>
            </h2>
            <div className="st-bar" style={{ margin: "0 0 8px" }}>
              {mode === "3d" && (["top", "iso", "side"] as View[]).map((v) => (
                <button key={v} className="st-btn" data-testid={`view-${v}`} onClick={() => setView((x) => ({ name: v, nonce: x.nonce + 1 }))}>{v[0].toUpperCase() + v.slice(1)}</button>
              ))}
              {mode === "3d" && <button className="st-btn" data-testid="view-reset" onClick={() => setView((x) => ({ name: "iso", nonce: x.nonce + 1 }))}>Reset view</button>}
              {mode === "3d" && <span className="st-sep" />}
              <button className={`st-btn ${tool.kind === "add" ? "st-btnOn" : ""}`} data-testid="add-jumper" onClick={() => dispatch(tool.kind === "add" ? { type: "cancelTool" } : { type: "beginAdd" })}>Add jumper</button>
            </div>
            {mode === null && <div className="st-hint" style={{ padding: 16 }}>Checking WebGL…</div>}
            {mode === "3d" && (
              <div className="st-board3d" data-testid="board3d">
                <Boundary onError={() => setFailed(true)}>
                  <Scene3D {...boardProps} />
                </Boundary>
              </div>
            )}
            {mode === "2d" && (
              <>
                {mode2dReason && <p className="st-hint" data-testid="fallback-reason">{mode2dReason}</p>}
                <Board2D {...boardProps} />
              </>
            )}
            {toolMsg && (
              <div className="st-tool" role="status" data-testid="tool-banner">
                <span>{toolMsg}</span>
                <button className="st-btn" onClick={() => dispatch({ type: "cancelTool" })}>Cancel (Esc)</button>
              </div>
            )}
            {state.notice && <div className="st-notice" role="alert">{state.notice}</div>}
            <p className="st-hint">3D: drag to orbit, scroll to zoom, right-drag to pan. 2D: arrow keys move between holes, Enter selects. Select a jumper, then click an end to move it.</p>
          </section>
        </div>

        <div className="st-below">
          <section className="st-card" aria-label="Inspector" data-testid="inspector">
            <h2>Inspector</h2>
            {inspector}
          </section>

          <section className="st-card" aria-label="Review" data-testid="review">
            <h2>
              <span>Review vs intended</span>
              <span className="st-badge">SIMULATED</span>
            </h2>
            <div className={`st-status ${identical ? "st-statusOk" : "st-statusBad"}`} role="status" data-testid="diff-status">
              {identical ? "Build matches the intended schematic." : `${diff.connectionDiffs.length + diff.componentDiffs.length} difference${diff.connectionDiffs.length + diff.componentDiffs.length === 1 ? "" : "s"} from the intended schematic.`}
            </div>
            {!identical && (
              <ul className="st-list" data-testid="diff-list">
                {diff.connectionDiffs.map((d) => (
                  <li key={`${d.componentId}.${d.terminal}`}>
                    <button onClick={() => dispatch({ type: "select", sel: { kind: "hole", id: d.holes[0] } })}>
                      <strong>{d.componentId} {d.terminal === "positive" ? "+" : "−"}</strong> should be on <strong>{d.intendedNode}</strong> but is on <strong>{d.observedNode}</strong> · holes {d.holes.join(", ")}
                    </button>
                  </li>
                ))}
                {diff.componentDiffs.map((d) => (
                  <li key={d.componentId + d.issue}>{d.componentId}: {d.issue.replace("_", " ")}{d.intended ? ` (intended ${d.intended.value})` : ""}{d.observed ? ` (built ${d.observed.value})` : ""}</li>
                ))}
                {diff.uncertainties.map((u) => (
                  <li key={u}>Cannot analyse: {u}</li>
                ))}
              </ul>
            )}
            <div className="st-volts">
              <div className="st-volt">
                <small>Intended {INTENDED.measureNode} <span className="st-badge">SIMULATED</span></small>
                <div className="st-num" data-testid="v-intended">{fmtV(INTENDED_V[INTENDED.measureNode])}</div>
              </div>
              <div className="st-volt">
                <small>Built {measure} <span className="st-badge">SIMULATED</span></small>
                <div className={`st-num ${builtV ? (Math.abs((builtV[measure] ?? NaN) - INTENDED_V[INTENDED.measureNode]) < 1e-6 ? "" : "st-numBad") : "st-numDim"}`} data-testid="v-built">
                  {builtV ? fmtV(builtV[measure]) : solve.status === "loading" ? "…" : "—"}
                </div>
              </div>
            </div>
            <label className="st-check">
              <input type="checkbox" data-testid="confirm" checked={state.confirmed} disabled={!graph} onChange={(e) => dispatch({ type: "confirm", value: e.target.checked })} />
              <span>I confirm this build is what I wired (revision {state.revision}). Confirming sends the built circuit to the solver. Any wiring edit clears this.</span>
            </label>
            {!graph && <p className="st-hint">The build cannot be solved yet: {built.errors[0]}</p>}
            {solve.status === "error" && <div className="st-notice" role="alert">{solve.error}</div>}
            {solved && (
              <table className="st-table" data-testid="solve-table">
                <thead><tr><th>Node</th><th>Intended</th><th>Built</th></tr></thead>
                <tbody>
                  {nodeRows.map((n) => (
                    <tr key={n}><td>{n}</td><td>{fmtV(INTENDED_V[n])}</td><td>{fmtV(builtV![n])}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="st-hint">Built values come from POST /api/solve on the graph derived from your wiring. Simulated DC only; not a measurement.</p>
          </section>
        </div>
      </main>
    </div>
  );
}
