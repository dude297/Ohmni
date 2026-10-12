import { describe, expect, it, vi } from "vitest";
import { DIVIDER_10K_10K } from "../../src/lib/circuit/fixtures";
import { LADDER_5V } from "../../src/app/probe/helpers";
import { probeStep } from "../../src/lib/probe";
import { solveDC } from "../../src/lib/circuit/solve";
import { diagnose } from "../../src/lib/diagnosis";
import {
  commitReading, getRecognitionCtor, groundedReply, initialState, reducer, speechErrorMessage,
  type Proposal, type Reading, type VLState,
} from "../../src/app/for-the-larp/voice-lab/machine";

const reading = (node: string, value: number, unit: "V" | "mV" = "V"): Reading => ({ type: "record_measurement", node, value, unit });
const proposalFor = (s: VLState, r: Reading): Proposal => ({ reading: r, revision: s.revision, transcript: "t" });
const confirmed = () => reducer(initialState, { type: "confirm_circuit" });

describe("state machine: confirmation required", () => {
  it("cannot listen or commit before the circuit is confirmed", () => {
    expect(reducer(initialState, { type: "listen" }).phase).toBe("error");
    const s = reducer(initialState, { type: "propose", proposal: proposalFor(initialState, reading("VOUT", 2.5)) });
    const c = reducer(s, { type: "commit_start" });
    expect(c.phase).toBe("error");
    expect(c.message).toMatch(/Confirm the circuit/);
  });
  it("cannot commit without a pending proposal", () => {
    expect(reducer(confirmed(), { type: "commit_start" }).phase).toBe("error");
  });
  it("proposal -> commit_start -> processing only through the confirming phase", () => {
    let s = reducer(confirmed(), { type: "listen" });
    expect(s.phase).toBe("listening");
    s = reducer(s, { type: "heard" });
    s = reducer(s, { type: "propose", proposal: proposalFor(s, reading("VOUT", 0.45)) });
    expect(s.phase).toBe("confirming");
    expect(s.observations).toEqual([]); // nothing recorded yet
    expect(reducer(s, { type: "commit_start" }).phase).toBe("processing");
    expect(reducer(s, { type: "cancel" })).toMatchObject({ phase: "idle", proposal: null, observations: [] });
  });
  it("refuses a stale proposal after the circuit changed", () => {
    let s = reducer(confirmed(), { type: "propose", proposal: proposalFor(confirmed(), reading("VOUT", 0.45)) });
    s = { ...s, revision: s.revision + 1 }; // circuit edited while the card was open
    const c = reducer(s, { type: "commit_start" });
    expect(c.phase).toBe("error");
    expect(c.message).toMatch(/circuit changed/);
    expect(c.proposal).toBeNull();
  });
  it("selecting a circuit resets confirmation and bumps the revision", () => {
    const s = reducer(confirmed(), { type: "select_circuit" });
    expect(s).toMatchObject({ circuitConfirmed: false, revision: 1, observations: [] });
  });
});

// Fake fetch that answers with the real local engines (same as the API routes, no network).
function fakeFetch() {
  return vi.fn(async (url: string, init: { body: string }) => {
    const b = JSON.parse(init.body);
    const result = url === "/api/solve"
      ? { ...solveDC(b.graph), grounded: true, trace: [], ...(b.measuredVoltage !== undefined ? { hypotheses: diagnose(b.graph, b.measuredVoltage) } : {}) }
      : probeStep(b.graph, b.observations);
    return { ok: true, status: 200, json: async () => ({ result }) };
  });
}

describe("API payloads", () => {
  it("measureNode reading -> solve gets measuredVoltage, probe gets observations", async () => {
    const f = fakeFetch();
    await commitReading(f, DIVIDER_10K_10K, [], reading("VOUT", 450, "mV"));
    const calls = Object.fromEntries(f.mock.calls.map(([u, i]) => [u, JSON.parse(i.body)]));
    expect(calls["/api/solve"]).toEqual({ graph: DIVIDER_10K_10K, userConfirmed: true, measuredVoltage: 0.45 });
    expect(calls["/api/probe"]).toEqual({ graph: DIVIDER_10K_10K, userConfirmed: true, observations: [{ node: "VOUT", volts: 0.45 }] });
  });
  it("other-node reading -> no measuredVoltage; probe accumulates observations", async () => {
    const f = fakeFetch();
    const r = await commitReading(f, LADDER_5V, [{ node: "B", volts: 0 }], reading("A", 5));
    const calls = Object.fromEntries(f.mock.calls.map(([u, i]) => [u, JSON.parse(i.body)]));
    expect(calls["/api/solve"]).not.toHaveProperty("measuredVoltage");
    expect(calls["/api/probe"].observations).toEqual([{ node: "B", volts: 0 }, { node: "A", volts: 5 }]);
    expect(r.observations).toHaveLength(2);
  });
  it("surfaces API errors", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ error: { message: "Circuit graph is invalid" } }) }));
    await expect(commitReading(f, DIVIDER_10K_10K, [], reading("VOUT", 1))).rejects.toThrow(/invalid/);
  });
});

describe("grounded reply", () => {
  it("ladder flow: B=0 -> measure A; A=5 -> conclusion", async () => {
    const f = fakeFetch();
    const r1 = await commitReading(f, LADDER_5V, [], reading("B", 0));
    expect(r1.reply).toContain("Your circuit predicts 1.67 volts at B. That reading doesn't match.");
    expect(r1.reply).toContain(`Measure node ${r1.probe.next!.node} next.`);
    expect(r1.probe.next!.node).toBe("A");
    expect(r1.reply).toContain("Leading hypothesis from the solver, not a confirmed fault:");
    expect(r1.solve.hypotheses?.length).toBeGreaterThan(0);
    const r2 = await commitReading(f, LADDER_5V, r1.observations, reading("A", 5));
    expect(r2.probe.done).toBe(true);
    expect(r2.reply).toContain(r2.probe.reason);
    expect(r2.reply).toContain("hypothesis, not a confirmed fault");
  });
  it("uses API values only (a doctored response changes the reply)", () => {
    const solve = { voltages: { VOUT: 3.21 }, currents: {}, grounded: true as const, trace: [] };
    const probe = { hypotheses: [], next: { node: "VIN", expectedBits: 1, instruction: "", outcomes: [] }, done: false, reason: "", safety: "" };
    const text = groundedReply(reading("VOUT", 0.45), solve, probe);
    expect(text).toContain("predicts 3.21 volts");
    expect(text).toContain("Measure node VIN next.");
    expect(text).not.toMatch(/2\.5/); // the real divider value is never invented
  });
  it("divider match within tolerance", async () => {
    const r = await commitReading(fakeFetch(), DIVIDER_10K_10K, [], reading("VOUT", 2.49));
    expect(r.reply).toContain("predicts 2.5 volts at VOUT. On its own, that reading is within meter tolerance");
  });
});

describe("speech plumbing", () => {
  it("recognition unavailable -> null (typed mode)", () => {
    expect(getRecognitionCtor({})).toBeNull();
    expect(getRecognitionCtor(undefined)).toBeNull();
    class W {}
    expect(getRecognitionCtor({ webkitSpeechRecognition: W })).toBe(W);
    expect(getRecognitionCtor({ SpeechRecognition: W })).toBe(W);
  });
  it("mic denied -> clear message with typed fallback", () => {
    expect(speechErrorMessage("not-allowed")).toMatch(/denied.*type/i);
    expect(speechErrorMessage("service-not-allowed")).toMatch(/denied/i);
    expect(speechErrorMessage("network")).toMatch(/type/i);
  });
});
