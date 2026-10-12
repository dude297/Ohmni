"use client";

import { useEffect, useState } from "react";
import { DISCLAIMER, EvidencePacket, buildExamplePacket, contentHash, derivedQuestions, fmt, parsePacket, residuals, toMarkdown } from "./packet";
import { TopBar } from "../build/top-bar";
import "../build/build.css";
import "./teams.css";

function save(name: string, type: string, body: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function TeamsClient() {
  const [packet, setPacket] = useState<EvidencePacket | null>(null);
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const [paste, setPaste] = useState("");
  const [notes, setNotes] = useState("");
  const [qs, setQs] = useState<string[]>([]);
  const [q, setQ] = useState("");

  const load = (text: string) => {
    const r = parsePacket(text);
    if (!r.ok) return setError(r.error);
    setError("");
    setPacket(r.packet);
  };

  useEffect(() => {
    try {
      const s = sessionStorage.getItem("ohmni.evidence.v1");
      if (s) queueMicrotask(() => load(s));
    } catch {}
  }, []);
  useEffect(() => {
    if (packet) contentHash(packet).then(setHash);
  }, [packet]);

  const md = () => toMarkdown(packet!, hash, notes, qs);

  return (
    <main className="tm-page">
      <TopBar />
      <h1>Team review</h1>
      <p className="tm-lede">Review an Ohmni evidence packet from the Build bench.</p>
      <p className="tm-banner">{DISCLAIMER}</p>

      <section className="tm-card tm-noprint">
        <button className="tm-btn" onClick={() => { setError(""); setPacket(buildExamplePacket()); }}>Load example packet</button>{" "}
        <label className="tm-btn tm-alt">
          Upload JSON
          <input type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text()); }} />
        </label>
        <textarea aria-label="Paste packet JSON" placeholder="...or paste packet JSON here" value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} />
        <button className="tm-btn tm-alt" onClick={() => load(paste)} disabled={!paste.trim()}>Review pasted packet</button>
        {error && <p role="alert" className="tm-err">{error}</p>}
      </section>

      {packet && (
        <>
          <section className="tm-card">
            <h2>{packet.circuit.name}</h2>
            <p>Packet created: {packet.createdAt}</p>
            <p>Provenance: {packet.circuit.provenance}</p>
            <p>Content hash (SHA-256 prefix): <code>{hash}</code> <em>content hash, not a signature</em></p>
          </section>

          <section className="tm-card">
            <h2>Observed vs predicted (V)</h2>
            <table className="tm-table">
              <thead><tr><th>Node</th><th>Observed</th><th>Predicted</th><th>Residual</th></tr></thead>
              <tbody>
                {residuals(packet).map((r, i) => (
                  <tr key={i}><td>{r.node}</td><td>{fmt(r.observed)}</td><td>{r.predicted === undefined ? "n/a" : fmt(r.predicted)}</td><td>{r.residual === undefined ? "n/a" : fmt(r.residual)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="tm-card">
            <h2>Hypotheses <small>modeled, single-fault, uncalibrated</small></h2>
            <ol>{packet.hypotheses.map((h) => <li key={h.id}>{h.title}: {fmt(h.probability * 100)}%</li>)}</ol>
          </section>

          <section className="tm-card">
            <h2>Recommended follow-up test</h2>
            <p>{packet.nextTest ? `${packet.nextTest.instruction} (expected information ${fmt(packet.nextTest.expectedBits)} bits)` : "None in packet."}</p>
          </section>

          <section className="tm-card">
            <h2>Repair</h2>
            {packet.repair ? (
              <>
                <p>{packet.repair.title} <span className={`tm-badge tm-${packet.repair.status}`}>{packet.repair.status}</span></p>
                {packet.repair.verification && <p>Verify node {packet.repair.verification.node}: expect {fmt(packet.repair.verification.expectVolts)} V +/- {fmt(packet.repair.verification.toleranceVolts)} V; measured {packet.repair.verification.measured === undefined ? "not measured" : fmt(packet.repair.verification.measured)}</p>}
              </>
            ) : <p>None in packet.</p>}
          </section>

          <section className="tm-card">
            <h2>Assumptions and unresolved questions</h2>
            <ul>
              {packet.assumptions.map((a, i) => <li key={"a" + i}>Assumption: {a}</li>)}
              {[...derivedQuestions(packet), ...qs].map((x, i) => <li key={"q" + i}>Open question: {x}</li>)}
            </ul>
            <div className="tm-noprint">
              <input aria-label="Add question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add an unresolved question" />{" "}
              <button className="tm-btn tm-alt" onClick={() => { if (q.trim()) { setQs([...qs, q.trim()]); setQ(""); } }}>Add</button>
            </div>
          </section>

          <section className="tm-card">
            <h2>Reviewer notes <small>local only</small></h2>
            <textarea aria-label="Reviewer notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
          </section>

          <section className="tm-card tm-noprint">
            <button className="tm-btn" onClick={() => save("ohmni-review.md", "text/markdown", md())}>Download Markdown</button>{" "}
            <button className="tm-btn tm-alt" onClick={() => save("ohmni-packet.json", "application/json", JSON.stringify(packet, null, 2))}>Download JSON</button>
          </section>
        </>
      )}
    </main>
  );
}
