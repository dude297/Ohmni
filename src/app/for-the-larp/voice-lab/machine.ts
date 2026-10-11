import type { CircuitGraph, SolveResponse } from "../../../lib/circuit/types";
import type { ProbeStep } from "../../../lib/probe";
import { fmtNum, fmtReading, volts, type VoiceIntent } from "./parser";

// Voice Lab state machine + API plumbing. Pure (fetch is injected) so it is unit-testable.

export type Phase = "idle" | "listening" | "processing" | "confirming" | "committed" | "error";
export type Reading = Extract<VoiceIntent, { type: "record_measurement" }>;
export type Proposal = { reading: Reading; revision: number; warning?: string; transcript: string };
export type Obs = { node: string; volts: number };

export type VLState = {
  phase: Phase;
  circuitConfirmed: boolean;
  revision: number; // bumps whenever the circuit changes; proposals carry the revision they were made for
  proposal: Proposal | null;
  observations: Obs[];
  message: string; // last reply / clarification shown on screen (and optionally spoken)
};

export type Action =
  | { type: "select_circuit" }
  | { type: "confirm_circuit" }
  | { type: "listen" }
  | { type: "heard" }
  | { type: "propose"; proposal: Proposal }
  | { type: "say"; message: string } // clarification or info, back to idle
  | { type: "cancel" }
  | { type: "commit_start" }
  | { type: "commit_done"; observations: Obs[]; message: string }
  | { type: "fail"; message: string };

export const initialState: VLState = { phase: "idle", circuitConfirmed: false, revision: 0, proposal: null, observations: [], message: "" };

/** Why a commit must be refused, or null if it may proceed. */
export function commitBlocker(s: VLState): string | null {
  if (!s.circuitConfirmed) return "Confirm the circuit first. Voice never confirms a circuit.";
  if (!s.proposal) return "There is no reading waiting for confirmation.";
  if (s.phase === "processing") return "Already recording this reading.";
  if (s.proposal.revision !== s.revision) return "The circuit changed after this reading was heard. Say the reading again.";
  return null;
}

export function reducer(s: VLState, a: Action): VLState {
  switch (a.type) {
    case "select_circuit":
      return { ...initialState, revision: s.revision + 1 };
    case "confirm_circuit":
      return { ...s, circuitConfirmed: true, phase: "idle", message: "" };
    case "listen":
      return s.circuitConfirmed ? { ...s, phase: "listening" } : { ...s, phase: "error", message: "Confirm the circuit first." };
    case "heard": // a pending proposal stays pending while the user answers it by voice
      return { ...s, phase: s.proposal ? "confirming" : "processing" };
    case "propose":
      return { ...s, phase: "confirming", proposal: a.proposal, message: "" };
    case "say":
      return { ...s, phase: s.proposal ? "confirming" : "idle", message: a.message };
    case "cancel":
      return { ...s, phase: "idle", proposal: null, message: s.proposal ? "Discarded. Nothing was recorded." : s.message };
    case "commit_start": {
      const block = commitBlocker(s);
      return block ? { ...s, phase: "error", proposal: s.proposal?.revision === s.revision ? s.proposal : null, message: block } : { ...s, phase: "processing" };
    }
    case "commit_done":
      return { ...s, phase: "committed", proposal: null, observations: a.observations, message: a.message };
    case "fail":
      return { ...s, phase: "error", message: a.message };
  }
}

/** Newest reading for a node replaces an older one. */
export const addObs = (list: Obs[], o: Obs) => [...list.filter((x) => x.node !== o.node), o];

export type ProbeResult = ProbeStep;
export type CommitResult = { observations: Obs[]; solve: SolveResponse; probe: ProbeResult; reply: string };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export async function postJSON<T>(fetchFn: Fetch, url: string, payload: unknown): Promise<T> {
  const res = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string; details?: string[] } } | null;
  if (!res.ok || !body?.result) {
    const e = body?.error;
    throw new Error(res.status === 429 ? "Too many requests. Wait a few seconds and retry." : e?.message ? `${e.message}${e.details?.length ? `: ${e.details.join("; ")}` : ""}` : `Request failed (HTTP ${res.status}).`);
  }
  return body.result;
}

/** /api/solve gets measuredVoltage ONLY for the graph's measureNode; every reading goes to /api/probe observations. */
export function payloads(graph: CircuitGraph, observations: Obs[], r: Reading) {
  const v = volts(r);
  return {
    solve: { graph, userConfirmed: true as const, ...(r.node === graph.measureNode ? { measuredVoltage: v } : {}) },
    probe: { graph, userConfirmed: true as const, observations },
  };
}

export async function commitReading(fetchFn: Fetch, graph: CircuitGraph, prior: Obs[], r: Reading): Promise<CommitResult> {
  const observations = addObs(prior, { node: r.node, volts: volts(r) });
  const p = payloads(graph, observations, r);
  const [solve, probe] = await Promise.all([
    postJSON<SolveResponse>(fetchFn, "/api/solve", p.solve),
    postJSON<ProbeResult>(fetchFn, "/api/probe", p.probe),
  ]);
  return { observations, solve, probe, reply: groundedReply(r, solve, probe) };
}

const sigma = (v: number) => 0.02 * Math.abs(v) + 0.01; // same meter tolerance /api/probe uses
const V = (v: number) => `${fmtNum(+v.toPrecision(3))} volts`;

/** Reply text built ONLY from the reading the user confirmed and the API responses. */
export function groundedReply(r: Reading, solve: SolveResponse, probe: ProbeResult): string {
  const out: string[] = [`Recorded ${fmtReading(r)} at ${r.node}.`];
  const expected = solve.voltages[r.node];
  if (Number.isFinite(expected)) {
    const ok = Math.abs(volts(r) - expected) <= 3 * sigma(volts(r));
    out.push(`Your circuit predicts ${V(expected)} at ${r.node}. ${ok ? "That reading matches within meter tolerance." : "That reading doesn't match."}`);
  }
  const lead = solve.hypotheses?.[0];
  if (lead && Number.isFinite(expected) && Math.abs(volts(r) - expected) > 3 * sigma(volts(r)))
    out.push(`Leading hypothesis from the solver, not a confirmed fault: ${lead.title}.`);
  if (probe.fitWarning) out.push(probe.fitWarning);
  if (probe.next) out.push(`Measure node ${probe.next.node} next.`);
  else if (probe.done) out.push(`${probe.reason} This is a hypothesis, not a confirmed fault.`);
  return out.join(" ");
}

/** Spoken/on-screen list of the top hypotheses from the last API response. */
export function hypothesesReply(probe: ProbeResult | null): string {
  if (!probe) return "No hypotheses yet. Record a reading first.";
  const top = probe.hypotheses.slice(0, 3).map((h) => `${h.title}, ${Math.round(h.probability * 100)} percent`);
  return `Top hypotheses, not confirmed faults: ${top.join("; ")}.`;
}

export function nextReply(probe: ProbeResult | null, graph: CircuitGraph): string {
  if (!probe) return `Start at ${graph.measureNode}: black probe on ${graph.groundNode}, red probe on ${graph.measureNode}, then say the reading.`;
  if (probe.next) return `Measure node ${probe.next.node} next. ${probe.next.instruction}`;
  return probe.reason;
}

/** Push-to-talk speech: constructor lookup (null => typed mode) and error-code to message mapping. */
type RecognitionCtor = new () => unknown;
export function getRecognitionCtor(w: unknown): RecognitionCtor | null {
  const x = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor } | undefined;
  return x?.SpeechRecognition ?? x?.webkitSpeechRecognition ?? null;
}
export function speechErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow the mic in your browser's site settings, or type the reading below.";
    case "no-speech":
      return "I didn't hear anything. Press the talk button and speak, or type the reading.";
    case "audio-capture":
      return "No microphone was found. Type the reading below.";
    case "network":
      return "The browser's speech service is unreachable. Type the reading below.";
    case "aborted":
      return "Listening cancelled.";
    default:
      return `Speech recognition error (${code}). Type the reading below.`;
  }
}
