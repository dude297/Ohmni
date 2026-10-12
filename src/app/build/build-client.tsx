"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { LOADED_BRIDGE_12V } from "../../lib/circuit/fixtures";
import type { FaultHypothesis, ProbeStep } from "../../lib/probe";
import type { RepairProposal } from "../../lib/repair";
import { apiErrorMessage, fmtPct, fmtV, parseVolts, schematicLayout } from "../probe/helpers";
import { buildPacket, EVIDENCE_KEY, logRows, type Reading } from "./evidence";
import "./build.css";

const GRAPH = LOADED_BRIDGE_12V;
const NODES = schematicLayout(GRAPH).nodes.map((n) => n.name).filter((n) => n !== GRAPH.groundNode);
type Solved = { voltages: Record<string, number>; currents: Record<string, number> };
type Verdict = { verified: boolean; status: "verified" | "not_verified"; message: string };
type Probe = ProbeStep;

async function post(url: string, payload: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(apiErrorMessage(res.status, body, res.headers.get("retry-after")));
  return body.result;
}

function Schematic({ volts, highlight }: { volts: Record<string, number>; highlight: string | null }) {
  const L = useMemo(() => schematicLayout(GRAPH), []);
  return (
    <svg className="bd-svg" viewBox={`0 0 ${L.width + 60} ${L.height}`} role="img" aria-label="Loaded bridge schematic">
      {L.parts.map((p) => {
        const mid = (p.a.y + p.b.y) / 2;
        return (
          <g key={p.id}>
            <path d={`M${p.a.x} ${p.a.y}H${p.laneX}V${p.b.y}H${p.b.x}`} className="bd-wire" />
            <rect x={p.laneX - 22} y={mid - 11} width={44} height={22} className="bd-part" />
            <text x={p.laneX} y={mid + 4} textAnchor="middle" className="bd-ptxt">{p.id}</text>
          </g>
        );
      })}
      {L.nodes.map((n) => (
        <g key={n.name} data-highlighted={highlight === n.name}>
          {highlight === n.name && <circle cx={n.x} cy={n.y} r={15} className="bd-hl" />}
          <circle cx={n.x} cy={n.y} r={6} className="bd-node" />
          <text x={n.x - 12} y={n.y - 10} textAnchor="end" className="bd-ntxt">{n.name}</text>
          {volts[n.name] !== undefined && <text x={n.x - 12} y={n.y + 8} textAnchor="end" className="bd-vtxt">{fmtV(volts[n.name])}</text>}
        </g>
      ))}
    </svg>
  );
}

export function BuildClient() {
  const [confirmed, setConfirmed] = useState(false);
  const [solved, setSolved] = useState<Solved | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [proposal, setProposal] = useState<RepairProposal | null>(null);
  const [approved, setApproved] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [vMeasured, setVMeasured] = useState<number | undefined>();
  const [node, setNode] = useState("C");
  const [volts, setVolts] = useState("");
  const [vv, setVv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const solve = () => run(async () => setSolved(await post("/api/solve", { graph: GRAPH, userConfirmed: true })));

  const addReading = () =>
    run(async () => {
      const v = parseVolts(volts);
      if (v === null) throw new Error("Enter the measured voltage, e.g. 7.533");
      const next = [...readings, { node, volts: v, at: new Date().toISOString() }];
      const latest = new Map(next.map((r) => [r.node, r.volts]));
      const observations = [...latest].map(([n, x]) => ({ node: n, volts: x }));
      const p: Probe = await post("/api/probe", { graph: GRAPH, userConfirmed: true, observations });
      setReadings(next);
      setProbe(p);
      setVolts("");
      setApproved(false);
      setVerdict(null);
      if (p.next) setNode(p.next.node);
      if (p.done || p.hypotheses[0]?.probability >= 0.5) {
        const r = await post("/api/repair", { graph: GRAPH, userConfirmed: true, observations });
        setProposal(r.proposals[0] ?? null);
      } else setProposal(null);
    });

  const verify = () =>
    run(async () => {
      if (!proposal) return;
      const v = parseVolts(vv);
      if (v === null) throw new Error("Enter the measured voltage");
      const r = await post("/api/repair/verify", {
        graph: GRAPH,
        userConfirmed: true,
        proposal: { hypothesisId: proposal.hypothesisId, verification: proposal.verification },
        measured: { node: proposal.verification.node, volts: v },
      });
      setVMeasured(v);
      setVerdict(r);
    });

  const nominal = solved?.voltages ?? {};
  const rows = logRows(readings, nominal);
  const hyps: FaultHypothesis[] = probe?.hypotheses.slice(0, 5) ?? [];

  const exportPacket = () => {
    const pkt = buildPacket({
      circuit: { name: "Loaded bridge 12 V", graph: GRAPH, provenance: "fixture LOADED_BRIDGE_12V, user-confirmed" },
      predictions: { voltages: nominal, currents: solved?.currents ?? {} },
      observations: readings,
      hypotheses: hyps.map((h) => ({ id: h.id, title: h.title, probability: h.probability })),
      nextTest: probe?.next ? { node: probe.next.node, instruction: probe.next.instruction, expectedBits: probe.next.expectedBits } : undefined,
      repair: proposal
        ? {
            title: proposal.title,
            patch: proposal.patch,
            before: proposal.before.voltages,
            after: proposal.after.voltages,
            status: verdict?.status ?? "hypothesized",
            verification: { ...proposal.verification, measured: vMeasured },
          }
        : undefined,
      safety: probe?.safety ?? "Low-voltage DC only. Ohmni makes no physical change.",
    });
    try {
      sessionStorage.setItem(EVIDENCE_KEY, JSON.stringify(pkt));
      setExported(true);
    } catch {
      setError("Could not store the evidence packet in this browser session");
    }
  };

  return (
    <main className="bd">
      <header className="bd-head">
        <h1>Build bench</h1>
        <p>Loaded bridge, 12 V. Measure, localise, repair, verify.</p>
      </header>

      <section className="bd-card" aria-labelledby="bd-s1">
        <h2 id="bd-s1">1. Circuit</h2>
        <div className="bd-grid">
          <Schematic volts={solved ? nominal : {}} highlight={probe && !probe.done ? probe.next?.node ?? null : null} />
          <div>
            <label className="bd-check">
              <input id="bd-confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I confirm this circuit
            </label>
            <button id="bd-solve" className="bd-btn" disabled={!confirmed || busy} onClick={solve}>Solve nominal</button>
            {solved && (
              <table className="bd-table" aria-label="Nominal solution">
                <thead><tr><th>Node</th><th>Volts</th><th>Branch</th><th>Amps</th></tr></thead>
                <tbody>
                  {Object.entries(solved.voltages).map(([n, v], i) => {
                    const c = Object.entries(solved.currents)[i];
                    return (
                      <tr key={n}>
                        <td>{n}</td><td className="bd-num">{v.toFixed(3)}</td>
                        <td>{c?.[0] ?? ""}</td><td className="bd-num">{c ? (c[1] * 1000).toFixed(3) + " mA" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {error && <p className="bd-err" role="alert">{error}</p>}

      <section className="bd-card" aria-labelledby="bd-s2">
        <h2 id="bd-s2">2. Measure</h2>
        {!solved ? <p className="bd-mute">Confirm and solve first.</p> : (
          <>
            <div className="bd-row">
              <label>Node
                <select id="bd-node" value={node} onChange={(e) => setNode(e.target.value)}>
                  {NODES.map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <label>Volts
                <input id="bd-volts" inputMode="decimal" value={volts} onChange={(e) => setVolts(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addReading()} />
              </label>
              <button id="bd-add" className="bd-btn" disabled={busy} onClick={addReading}>Add reading</button>
            </div>
            {probe?.next && !probe.done && (
              <div className="bd-next">
                <div className="bd-big">Probe {probe.next.node}</div>
                <p>{probe.next.instruction}</p>
                <ul>
                  {probe.next.outcomes.slice(0, 4).map((o, i) => (
                    <li key={i}>about {fmtV(o.volts)} suggests {o.hypothesisIds.slice(0, 3).join(", ")} ({fmtPct(o.probability)})</li>
                  ))}
                </ul>
              </div>
            )}
            {hyps.length > 0 && (
              <ul className="bd-hyps" aria-label="Ranked hypotheses">
                {hyps.map((h) => (
                  <li key={h.id}>
                    <span>{h.title}</span><b>{fmtPct(h.probability)}</b>
                    <div className="bd-track"><div className="bd-fill" style={{ width: `${Math.max(2, h.probability * 100)}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
            {rows.length > 0 && (
              <table className="bd-table" aria-label="Evidence log">
                <thead><tr><th>Time</th><th>Node</th><th>Measured</th><th>Nominal</th><th>Residual</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{new Date(r.at).toLocaleTimeString()}</td><td>{r.node}</td>
                      <td className="bd-num">{r.volts.toFixed(3)}</td>
                      <td className="bd-num">{r.predicted?.toFixed(3) ?? "-"}</td>
                      <td className="bd-num">{Number.isNaN(r.residual) ? "-" : (r.residual > 0 ? "+" : "") + r.residual.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      {proposal && (
        <section className="bd-card" aria-labelledby="bd-s3">
          <h2 id="bd-s3">3. Repair proposal</h2>
          <div className="bd-big" data-testid="proposal-title">{proposal.title}</div>
          <p className="bd-mute">
            Patch: {proposal.patch.componentId} {proposal.patch.faultedValue} to {proposal.patch.designValue} {proposal.patch.unit} · hypothesized {fmtPct(proposal.probability)}
          </p>
          <table className="bd-table" aria-label="Before and after">
            <thead><tr><th>Node</th><th>Measured</th><th>Simulated before</th><th>Simulated after</th></tr></thead>
            <tbody>
              {Object.keys(proposal.after.voltages).filter((n) => n !== "GND").map((n) => {
                const m = [...readings].reverse().find((r) => r.node === n);
                return (
                  <tr key={n}>
                    <td>{n}</td>
                    <td className="bd-num">{m ? m.volts.toFixed(3) : "-"}</td>
                    <td className="bd-num">{proposal.before.voltages[n]?.toFixed(3)}</td>
                    <td className="bd-num">{proposal.after.voltages[n]?.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ol>{proposal.actions.map((a, i) => <li key={i}>{a}</li>)}</ol>
          <p className="bd-mute">{proposal.uncertainty}</p>
          {!approved ? (
            <button id="bd-approve" className="bd-btn" onClick={() => setApproved(true)}>Approve plan (Ohmni makes no physical change)</button>
          ) : (
            <div className="bd-verify">
              <p>{proposal.verification.instruction}</p>
              <div className="bd-row">
                <label>Measured at {proposal.verification.node} (V)
                  <input id="bd-vv" inputMode="decimal" value={vv} onChange={(e) => setVv(e.target.value)} onKeyDown={(e) => e.key === "Enter" && verify()} />
                </label>
                <button id="bd-verify" className="bd-btn" disabled={busy} onClick={verify}>Verify</button>
              </div>
              {verdict && (
                <div className={verdict.verified ? "bd-badge bd-ok" : "bd-badge bd-bad"} role="status">
                  {verdict.verified ? "VERIFIED" : "NOT VERIFIED"}
                  <small>{verdict.message}</small>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {readings.length > 0 && (
        <section className="bd-card" aria-labelledby="bd-s4">
          <h2 id="bd-s4">4. Hand off</h2>
          <button id="bd-export" className="bd-btn" onClick={exportPacket}>Export evidence to Teams</button>{" "}
          {exported && <Link id="bd-teams" href="/teams" className="bd-link">Open Teams</Link>}
        </section>
      )}
    </main>
  );
}
