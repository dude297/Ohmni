"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, ArrowLeft, Check, Loader2, Mic, MicOff, Volume2, X } from "lucide-react";
import { Brand } from "../../../components/ohmni/brand";
import { CIRCUITS, schematicLayout } from "../../probe/helpers";
import type { CircuitGraph } from "../../../lib/circuit/types";
import { fmtNum, fmtReading, parseCommand } from "./parser";
import {
  commitBlocker, commitReading, getRecognitionCtor, hypothesesReply, initialState, nextReply, postJSON, reducer,
  speechErrorMessage, type Phase, type ProbeResult,
} from "./machine";
import "./voice-lab.css";

// ponytail: ladder first-class, divider default (matches the e2e demo order in the PR).
const ORDER = ["divider", "ladder", "series-parallel"];
const CIRCS = ORDER.map((k) => CIRCUITS.find((c) => c.key === k)!);

type Source = "main" | "card";
const noSubscribe = () => () => {};
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type Explain = { explanation: { summary: string; steps: { title: string; text: string }[] } | null; grounded: boolean; ungroundedNumbers: string[] };

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready", listening: "Listening", processing: "Working", confirming: "Awaiting your confirmation", committed: "Recorded", error: "Attention",
};

function Schematic({ graph, highlight, heard, readings }: { graph: CircuitGraph; highlight: string | null; heard: string | null; readings: Record<string, number> }) {
  const { nodes, parts, width, height } = schematicLayout(graph);
  return (
    <svg className="vl-schem" viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Circuit schematic.${highlight ? ` Probe node ${highlight} next.` : ""}${heard ? ` Pending reading at ${heard}.` : ""}`}>
      {parts.map((p) => {
        const mid = (p.a.y + p.b.y) / 2;
        return (
          <g key={p.id} className="vl-part">
            <path d={`M${p.a.x} ${p.a.y}H${p.laneX}V${p.b.y}H${p.b.x}`} fill="none" />
            <rect x={p.laneX - 9} y={mid - 14} width={18} height={28} rx={2} data-kind={p.kind} />
            <text x={p.laneX + 14} y={mid + 4}>{p.id}</text>
          </g>
        );
      })}
      {nodes.map((n) => {
        const on = n.name === highlight;
        const h = n.name === heard;
        return (
          <g key={n.name} data-node={n.name} data-highlight={on || undefined} data-heard={h || undefined}>
            {on && <circle className="vl-ring" cx={n.x} cy={n.y} r={14} />}
            {h && <circle className="vl-heardRing" cx={n.x} cy={n.y} r={13} />}
            <circle className={on ? "vl-dot vl-dotOn" : "vl-dot"} cx={n.x} cy={n.y} r={on ? 7 : 5} />
            <text className="vl-nlabel" x={n.x - (on || h ? 20 : 14)} y={n.y + 4} textAnchor="end">{n.name}</text>
            {n.name in readings && <text className="vl-nread" x={n.x - 14} y={n.y + 20} textAnchor="end">{fmtNum(+readings[n.name].toPrecision(3))} V</text>}
            {on && <text className="vl-ncall" x={n.x + 12} y={n.y + 22}>probe here</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function VoiceLab() {
  const [ci, setCi] = useState(0);
  const graph = CIRCS[ci].graph;
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; }, [state]);

  const [micDenied, setMicDenied] = useState(false);
  const [listenSrc, setListenSrc] = useState<Source | null>(null);
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState("");
  const [typed, setTyped] = useState("");
  const [cardTyped, setCardTyped] = useState("");
  const [speakOn, setSpeakOn] = useState(true);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [solveHyp, setSolveHyp] = useState<{ title: string; nextMeasurement: string }[]>([]);
  const [exp, setExp] = useState<Explain | null>(null);
  const [expBusy, setExpBusy] = useState(false);
  const [expErr, setExpErr] = useState("");
  const recRef = useRef<Rec | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);

  // Feature detection only (null on the server); nothing starts listening until the user presses the button.
  const supported = useSyncExternalStore(noSubscribe, () => getRecognitionCtor(window) !== null, () => null);

  const speak = useCallback(
    (text: string) => {
      if (!speakOn || typeof window === "undefined" || !("speechSynthesis" in window) || !text) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/\bmV\b/g, "millivolts").replace(/(\d) V\b/g, "$1 volts"));
      u.lang = "en-US";
      window.speechSynthesis.speak(u);
    },
    [speakOn],
  );
  const say = useCallback((message: string) => { dispatch({ type: "say", message }); speak(message); }, [speak]);

  useEffect(() => {
    if (state.phase !== "confirming") return;
    cardRef.current?.focus({ preventScroll: true });
    cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [state.phase, state.proposal]);

  const doCommit = useCallback(async () => {
    const s = stateRef.current;
    const block = commitBlocker(s);
    dispatch({ type: "commit_start" });
    if (block || !s.proposal) return speak(block ?? "");
    try {
      const r = await commitReading((u, i) => fetch(u, i), graph, s.observations, s.proposal.reading);
      if (stateRef.current.revision !== s.revision) return; // circuit changed mid-flight: drop the result
      setProbe(r.probe);
      if (s.proposal.reading.node === graph.measureNode) setSolveHyp(r.solve.hypotheses ?? []);
      setExp(null);
      dispatch({ type: "commit_done", observations: r.observations, message: r.reply });
      speak(r.reply);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Request failed.";
      dispatch({ type: "fail", message: `${m} Nothing was recorded.` });
      speak(m);
    }
  }, [graph, speak]);

  const runExplain = useCallback(async () => {
    const s = stateRef.current;
    if (!s.circuitConfirmed) return say("Confirm the circuit first.");
    setExpBusy(true);
    setExpErr("");
    try {
      const measured = s.observations.find((o) => o.node === graph.measureNode)?.volts;
      const r = await postJSON<Explain>((u, i) => fetch(u, i), "/api/explain", { graph, userConfirmed: true, ...(measured !== undefined ? { measuredVoltage: measured } : {}) });
      setExp(r);
      if (r.explanation) speak(r.explanation.summary);
    } catch (e) {
      setExpErr(e instanceof Error ? e.message : "Explain is unavailable right now.");
    } finally {
      setExpBusy(false);
    }
  }, [graph, say, speak]);

  const handleText = useCallback(
    (text: string, source: Source) => {
      const s = stateRef.current;
      setTranscript(text);
      if (!s.circuitConfirmed) return say("Confirm the circuit first. Voice never confirms a circuit.");
      const { intent, warning } = parseCommand(text, graph);
      switch (intent.type) {
        case "confirm":
          if (source === "card" && s.proposal) return void doCommit();
          return say(s.proposal ? "To record it, press Confirm on the reading card, or say yes using the card's own talk button." : "There is no reading waiting for confirmation.");
        case "cancel":
          if (s.proposal) { dispatch({ type: "cancel" }); return speak("Discarded."); }
          return say("Nothing to cancel.");
        case "record_measurement": {
          dispatch({ type: "propose", proposal: { reading: intent, revision: s.revision, warning, transcript: text } });
          return speak(`I heard ${fmtReading(intent)} at ${intent.node}. Correct?${warning ? " Check your range." : ""}`);
        }
        case "next_probe":
          return say(nextReply(probe, graph));
        case "show_hypotheses":
          return say(hypothesesReply(probe));
        case "repeat":
          return say(s.message || "Nothing to repeat yet.");
        case "explain_result":
          return void runExplain();
        case "unknown":
          return say(intent.reason);
      }
    },
    [graph, say, speak, doCommit, runExplain, probe],
  );

  const stopListening = useCallback((abort: boolean) => {
    const r = recRef.current;
    if (!r) return;
    if (abort) r.abort();
    else r.stop();
  }, []);

  const startListening = useCallback(
    (source: Source) => {
      const Ctor = getRecognitionCtor(window) as (new () => Rec) | null;
      if (!Ctor) return;
      if (!stateRef.current.circuitConfirmed) return say("Confirm the circuit first.");
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let final = "";
      rec.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) final += res[0].transcript;
          else live += res[0].transcript;
        }
        setInterim(live);
      };
      rec.onerror = (e) => {
        final = "";
        if (e.error === "not-allowed" || e.error === "service-not-allowed") setMicDenied(true);
        if (e.error === "aborted") dispatch({ type: "cancel" });
        else dispatch({ type: "fail", message: speechErrorMessage(e.error) });
        if (e.error !== "aborted") typedRef.current?.focus();
      };
      rec.onend = () => {
        recRef.current = null;
        setListenSrc(null);
        setInterim("");
        if (final.trim()) {
          dispatch({ type: "heard" });
          handleText(final.trim(), source);
        } else if (stateRef.current.phase === "listening") {
          const m = speechErrorMessage("no-speech");
          dispatch(stateRef.current.proposal ? { type: "say", message: m } : { type: "fail", message: m });
        }
      };
      recRef.current = rec;
      setListenSrc(source);
      dispatch({ type: "listen" });
      try {
        rec.start();
      } catch {
        recRef.current = null;
        setListenSrc(null);
        dispatch({ type: "fail", message: speechErrorMessage("unknown") });
      }
    },
    [handleText, say],
  );

  const toggleTalk = (source: Source) => (listenSrc ? stopListening(false) : startListening(source));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (recRef.current) stopListening(true);
      else if (stateRef.current.proposal) { dispatch({ type: "cancel" }); typedRef.current?.focus(); }
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [stopListening]);

  function pickCircuit(i: number) {
    stopListening(true);
    setCi(i);
    setProbe(null);
    setSolveHyp([]);
    setExp(null);
    setTranscript("");
    dispatch({ type: "select_circuit" });
  }

  const { phase, proposal, circuitConfirmed, observations, message } = state;
  const readings = Object.fromEntries(observations.map((o) => [o.node, o.volts]));
  const highlight = probe && !probe.done ? probe.next?.node ?? null : null;
  const busy = phase === "processing";
  const typedMode = supported === false;

  return (
    <div className="ohmni lab-page vl-page">
      <header className="site-header lab-header">
        <Brand />
        <nav aria-label="Voice Lab navigation">
          <Link href="/for-the-larp" className="back-link"><ArrowLeft size={15} /> Under the Hood</Link>
          <span className="workspace-tag"><span className="tiny-dot" /> VOICE LAB · EXPERIMENTAL</span>
        </nav>
      </header>

      <main className="vl-main">
        <div className="vl-title">
          <h1>Hands-free probing</h1>
          <p>Both hands on the probes. Press talk, say the reading, confirm it. Ohmni answers from the circuit solver and the Probe Guide, never from a guess.</p>
        </div>

        <div className="vl-grid">
          <section className="workspace-panel vl-panel" aria-labelledby="vl-circ-h">
            <h2 id="vl-circ-h" className="vl-h2">1 · Circuit</h2>
            <div className="vl-picker" role="group" aria-label="Choose an example circuit">
              {CIRCS.map((c, i) => (
                <button key={c.key} type="button" aria-pressed={i === ci} disabled={busy} className={`vl-pick ${i === ci ? "vl-pickOn" : ""}`} onClick={() => pickCircuit(i)}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="vl-muted"><span className="vl-fixture">Example fixture</span> {CIRCS[ci].blurb}</p>
            <Schematic graph={graph} highlight={highlight} heard={phase === "confirming" ? proposal?.reading.node ?? null : null} readings={readings} />
            {circuitConfirmed ? (
              <p className="vl-ok"><Check size={15} aria-hidden /> Circuit confirmed by you. Change it above to start over.</p>
            ) : (
              <button type="button" className="button primary vl-confirmCirc" onClick={() => dispatch({ type: "confirm_circuit" })}>
                <Check size={16} aria-hidden /> I confirm this matches my circuit
              </button>
            )}
            <h3 className="vl-h3">Recorded readings</h3>
            {observations.length ? (
              <ul className="vl-chips" aria-label="Recorded readings">
                {observations.map((o) => <li key={o.node} className="vl-chip"><b>{o.node}</b> {fmtNum(+o.volts.toPrecision(4))} V</li>)}
              </ul>
            ) : (
              <p className="vl-muted">None yet. Nothing is recorded until you press Confirm.</p>
            )}
          </section>

          <section className="vl-console" aria-labelledby="vl-voice-h">
            <div className="vl-consoleTop">
              <h2 id="vl-voice-h" className="vl-h2 vl-onDark">2 · Voice console</h2>
              <div className="vl-status" data-phase={phase}>
                <span className="vl-led" aria-hidden /> <span>{PHASE_LABEL[phase]}</span>
              </div>
            </div>
            <p className="vl-sr" aria-live="assertive" role="status">{PHASE_LABEL[phase]}{message ? `. ${message}` : ""}</p>

            {!circuitConfirmed && <p className="vl-note">Confirm the circuit on the left to enable voice and typed commands.</p>}
            {typedMode && <p className="vl-note">Speech recognition isn&apos;t available in this browser (e.g. Firefox). Typed mode is on; everything works the same.</p>}
            {micDenied && <p className="vl-note vl-noteWarn" role="alert"><MicOff size={14} aria-hidden /> Microphone access was denied. Allow it in site settings, or type below.</p>}

            <div className="vl-controls">
              {!typedMode && (
                <button type="button" className="vl-ptt" aria-pressed={listenSrc === "main"} disabled={!circuitConfirmed || busy || listenSrc === "card" || supported === null}
                  onClick={() => toggleTalk("main")}>
                  <Mic size={22} aria-hidden />
                  <span>{listenSrc === "main" ? "Listening… press to stop" : "Push to talk"}</span>
                  <small>Space / Enter · Esc cancels</small>
                </button>
              )}
              <form className="vl-typed" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { handleText(typed.trim(), "main"); setTyped(""); } }}>
                <label htmlFor="vl-typed-in">Type a command</label>
                <div className="vl-row">
                  <input id="vl-typed-in" ref={typedRef} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!circuitConfirmed || busy}
                    placeholder={`${graph.measureNode} is 0.45 volts`} autoComplete="off" />
                  <button className="button secondary" disabled={!circuitConfirmed || busy || !typed.trim()}>Send</button>
                </div>
              </form>
            </div>

            <div className="vl-readout" aria-label="Transcript">
              <span className="vl-k">HEARD</span>
              <span className="vl-v">{interim ? <i>{interim}</i> : transcript || "—"}</span>
            </div>
            <p className="vl-hint">Try: “{graph.measureNode} is two point five volts”, “450 millivolts at {graph.measureNode}”, “next”, “show hypotheses”, “explain”, “repeat”.</p>

            {(phase === "confirming" || phase === "listening") && proposal && (
              <div className="vl-card" ref={cardRef} tabIndex={-1} role="group" aria-labelledby="vl-card-h">
                <p className="vl-eyebrow">CONFIRM READING · NOTHING RECORDED YET</p>
                <p id="vl-card-h" className="vl-big">
                  I heard <mark>{fmtNum(proposal.reading.value)}</mark> <mark>{proposal.reading.unit}</mark> at <mark>{proposal.reading.node}</mark>. Correct?
                </p>
                {proposal.reading.unit === "mV" && <p className="vl-muted">= {fmtReading(proposal.reading)}</p>}
                {proposal.warning && <p className="vl-warn" role="alert"><AlertTriangle size={15} aria-hidden /> {proposal.warning}</p>}
                <div className="vl-row">
                  <button type="button" className="button primary" onClick={() => void doCommit()}><Check size={16} aria-hidden /> Confirm</button>
                  <button type="button" className="button secondary" onClick={() => { dispatch({ type: "cancel" }); typedRef.current?.focus(); }}><X size={16} aria-hidden /> Cancel (Esc)</button>
                </div>
                <form className="vl-cardTyped" onSubmit={(e) => { e.preventDefault(); if (cardTyped.trim()) { handleText(cardTyped.trim(), "card"); setCardTyped(""); } }}>
                  <label htmlFor="vl-card-in">…or answer here: type “yes” / “no” or a corrected reading</label>
                  <div className="vl-row">
                    <input id="vl-card-in" value={cardTyped} onChange={(e) => setCardTyped(e.target.value)} autoComplete="off" placeholder="yes" />
                    <button className="button secondary" disabled={!cardTyped.trim()}>Answer</button>
                    {!typedMode && (
                      <button type="button" className="vl-pttSmall" aria-pressed={listenSrc === "card"} disabled={listenSrc === "main" || supported === null} onClick={() => toggleTalk("card")}>
                        <Mic size={16} aria-hidden /> {listenSrc === "card" ? "Listening…" : "Say yes / no"}
                      </button>
                    )}
                  </div>
                </form>
              </div>
            )}

            {busy && <p className="vl-reply"><Loader2 className="vl-spin" size={16} aria-hidden /> Asking the solver and Probe Guide…</p>}
            {message && phase !== "confirming" && !busy && (
              <div className={`vl-reply ${phase === "error" ? "vl-replyErr" : ""}`}>
                <span className="vl-k">OHMNI</span>
                <p>{message}</p>
                {speakOn && <button type="button" className="vl-link" onClick={() => speak(message)}><Volume2 size={14} aria-hidden /> Speak again</button>}
              </div>
            )}
            {message && phase === "confirming" && <p className="vl-note">{message}</p>}

            {probe && (
              <div className="vl-hyp">
                <span className="vl-k">HYPOTHESES · NOT CONFIRMED FAULTS · from /api/probe</span>
                <ol>
                  {probe.hypotheses.slice(0, 3).map((h) => <li key={h.id}>{h.title} <b>{Math.round(h.probability * 100)}%</b></li>)}
                </ol>
                {solveHyp.length > 0 && (
                  <>
                    <span className="vl-k vl-kGap">SOLVER HYPOTHESES FOR {graph.measureNode} · from /api/solve</span>
                    <ol>{solveHyp.slice(0, 3).map((h) => <li key={h.title}>{h.title} <span className="vl-dim">· {h.nextMeasurement}</span></li>)}</ol>
                  </>
                )}
                <p className="vl-safety">{probe.safety}</p>
              </div>
            )}

            <div className="vl-foot">
              <button type="button" className="button secondary" disabled={!circuitConfirmed || expBusy} onClick={() => void runExplain()}>
                {expBusy ? <Loader2 className="vl-spin" size={15} aria-hidden /> : null} Explain (Gemini)
              </button>
              <label className="vl-check"><input type="checkbox" checked={speakOn} onChange={(e) => { setSpeakOn(e.target.checked); if (!e.target.checked) window.speechSynthesis?.cancel(); }} /> Speak replies</label>
            </div>
            {expErr && <p className="vl-warn">{expErr}</p>}
            {exp && (
              <div className="vl-explain" aria-live="polite">
                <span className={`vl-badge ${exp.grounded ? "vl-badgeOk" : "vl-badgeWarn"}`}>{exp.grounded ? "Grounded: every number matches the solver" : `Not grounded${exp.ungroundedNumbers.length ? `: ${exp.ungroundedNumbers.join(", ")}` : ""}`}</span>
                {exp.explanation ? <p>{exp.explanation.summary}</p> : <p>The tutor returned no explanation.</p>}
              </div>
            )}

            <details className="vl-privacy">
              <summary>Privacy &amp; how this works</summary>
              <p>Push-to-talk only: the mic opens only while the talk button is pressed. Speech-to-text is done by your browser&apos;s Web Speech API; in Chrome and Edge that sends audio to the browser vendor&apos;s cloud service, so it is not guaranteed local or private. Ohmni never receives or stores audio, only the transcript text you see. Voice Lab runs no transcription model of its own.</p>
              <p>Readings are parsed by a deterministic typed parser (no AI). Replies are assembled only from /api/solve and /api/probe responses. Explain calls /api/explain (Gemini) and shows whether its numbers match the solver.</p>
            </details>
          </section>
        </div>
      </main>
    </div>
  );
}
