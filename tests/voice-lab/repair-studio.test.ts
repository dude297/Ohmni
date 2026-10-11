import { describe, expect, it, vi } from "vitest";
import { parseCommand } from "../../src/app/for-the-larp/voice-lab/parser";
import { LOADED_BRIDGE } from "../../src/app/for-the-larp/voice-lab/bridge";
import { DIVIDER_10K_10K } from "../../src/lib/circuit/fixtures";
import {
  initialState, reducer, voiceConfirmBlocker, type Proposal, type Reading, type VLState,
} from "../../src/app/for-the-larp/voice-lab/machine";
import {
  RepairUnavailable, fetchRepair, nodeDiffs, proposalNarration, repairReady, verifyBadge, verifyNarration, verifyRepair,
  type RepairProposal,
} from "../../src/app/for-the-larp/voice-lab/repair";
import { probeStep } from "../../src/lib/probe";

const G = DIVIDER_10K_10K;
const rec = (t: string, g = G) => parseCommand(t, g).intent as Extract<ReturnType<typeof parseCommand>["intent"], { type: "record_measurement" }>;

describe("parser: Repair Studio phrases", () => {
  it("negative numbers", () => {
    expect(rec("negative one point two volts at vout")).toMatchObject({ node: "VOUT", value: -1.2, unit: "V" });
    expect(rec("vout is minus 1.2 V")).toMatchObject({ value: -1.2 });
  });
  it("natural phrasing", () => {
    expect(rec("I'm getting four hundred fifty millivolts at VOUT")).toMatchObject({ node: "VOUT", value: 450, unit: "mV" });
    expect(rec("V out reads zero point four five volts")).toMatchObject({ node: "VOUT", value: 0.45 });
    expect(rec("C is zero volts", LOADED_BRIDGE)).toMatchObject({ node: "C", value: 0 });
    expect(rec("A reads seven point five three volts", LOADED_BRIDGE)).toMatchObject({ node: "A", value: 7.53 });
  });
  it.each([
    ["What's the next measurement?", "next_probe"], ["What are the likely faults?", "show_hypotheses"], ["Explain why", "explain_result"],
    ["Repeat that", "repeat"], ["Cancel", "cancel"], ["Yes, record that", "confirm"],
  ])("%s -> %s", (t, type) => expect(parseCommand(t, G).intent.type).toBe(type));
  it("correction needs a pending node and keeps it", () => {
    const p = parseCommand("No, change it to five point two volts", G, { pendingNode: "VOUT" }).intent;
    expect(p).toMatchObject({ type: "correct_measurement", node: "VOUT", value: 5.2, unit: "V" });
    expect(parseCommand("No, change it to five point two volts", G).intent.type).toBe("unknown"); // nothing pending
  });
  it("unsupported is an honest refusal", () => {
    const i = parseCommand("order me a pizza", G).intent;
    expect(i).toMatchObject({ type: "unknown" });
    expect((i as { reason: string }).reason).toMatch(/can't do that yet/);
  });
});

const reading = (node: string, value: number): Reading => ({ type: "record_measurement", node, value, unit: "V" });
const prop = (s: VLState, r: Reading): Proposal => ({ reading: r, revision: s.revision, transcript: "t" });
const base = reducer(initialState, { type: "confirm_circuit" });

describe("machine: correction / confirm / duplicates / stale", () => {
  it("correction replaces the pending value and requires a fresh confirm", () => {
    let s = reducer(base, { type: "propose", proposal: prop(base, reading("C", 0)) });
    const id1 = s.proposal!.id;
    s = reducer(s, { type: "correct", reading: reading("C", 5.2), transcript: "fix" });
    expect(s).toMatchObject({ phase: "confirming", observations: [] });
    expect(s.proposal!.reading.value).toBe(5.2);
    expect(s.proposal!.id).not.toBe(id1);
    expect(voiceConfirmBlocker(s)).toBeNull();
  });
  it("correction without a proposal does nothing", () => {
    expect(reducer(base, { type: "correct", reading: reading("C", 1), transcript: "x" }).proposal).toBeNull();
  });
  it("yes only applies to a displayed, current proposal", () => {
    expect(voiceConfirmBlocker(base)).toMatch(/no reading waiting/);
    const s = reducer(base, { type: "propose", proposal: prop(base, reading("C", 0)) });
    expect(voiceConfirmBlocker(s)).toBeNull();
    expect(voiceConfirmBlocker({ ...s, phase: "idle" })).toMatch(/no reading waiting/);
    expect(voiceConfirmBlocker({ ...s, revision: s.revision + 1 })).toMatch(/circuit changed/);
    expect(voiceConfirmBlocker({ ...s, phase: "processing" })).toMatch(/no reading waiting/);
  });
  it("duplicate re-heard reading does not re-arm; commit in flight is not swapped", () => {
    const s = reducer(base, { type: "propose", proposal: prop(base, reading("C", 0)) });
    const d = reducer(s, { type: "propose", proposal: prop(s, reading("C", 0)) });
    expect(d.seq).toBe(s.seq);
    expect(d.proposal!.id).toBe(s.proposal!.id);
    const p = reducer(s, { type: "commit_start" });
    expect(reducer(p, { type: "propose", proposal: prop(p, reading("A", 3)) }).proposal!.reading.node).toBe("C");
    expect(reducer(p, { type: "commit_start" })).toBe(p); // double-tap idempotent
  });
});

// ---- repair client with mocked fetch ----
const proposal: RepairProposal = {
  id: "p1", hypothesisId: "R6:open", title: "Restore R6 connection", faultClass: "open", target: { componentId: "R6" }, probability: 0.8,
  patch: { kind: "restore_design", componentId: "R6", faultedValue: 1e9, designValue: 680, unit: "ohm" },
  supportingObservations: [{ node: "C", measured: 0, predictedIfFault: 0, predictedIfRepaired: 2.6089 }],
  before: { voltages: { C: 0, A: 7.53, VIN: 12, GND: 0 }, currents: {} }, after: { voltages: { C: 2.6089, A: 7.2, VIN: 12, GND: 0 }, currents: {} },
  verification: { instruction: "Measure C", node: "C", expectVolts: 2.6089, toleranceVolts: 0.0622 }, actions: ["Reseat R6"], status: "hypothesized",
};
const okFetch = (result: unknown) => vi.fn(async (_u: string, _i: { body: string }) => ({ ok: true, status: 200, json: async () => ({ result }) }));

describe("repair client", () => {
  it("posts the contract body and maps the response", async () => {
    const f = okFetch({ proposals: [proposal, { bogus: true }], basis: { topHypothesisId: "R6:open", topProbability: 0.8, done: true } });
    const r = await fetchRepair(f, LOADED_BRIDGE, [{ node: "C", volts: 0 }]);
    expect(f.mock.calls[0][0]).toBe("/api/repair");
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ userConfirmed: true, observations: [{ node: "C", volts: 0 }] });
    expect(r.proposals).toHaveLength(1); // malformed proposal dropped
    expect(proposalNarration(r)).toMatch(/Restore R6 connection is now the leading hypothesis within the tested fault set/);
  });
  it("404 -> RepairUnavailable", async () => {
    const f = vi.fn(async (_u: string, _i: { method: string; headers: Record<string, string>; body: string }) => ({ ok: false, status: 404, json: async () => null }));
    await expect(fetchRepair(f, LOADED_BRIDGE, [])).rejects.toThrow(RepairUnavailable);
    await expect(fetchRepair(f, LOADED_BRIDGE, [])).rejects.toThrow("Repair engine not available on this build");
  });
  it("verify flow + badges: VERIFIED only when the API says so", async () => {
    const ok = okFetch({ verified: true, status: "verified", delta: 0.001, message: "Matches." });
    const v = await verifyRepair(ok, LOADED_BRIDGE, proposal, { node: "C", volts: 2.61 });
    expect(ok.mock.calls[0][0]).toBe("/api/repair/verify");
    expect(JSON.parse(ok.mock.calls[0][1].body)).toMatchObject({ proposal: { hypothesisId: "R6:open", verification: { node: "C" } }, measured: { node: "C", volts: 2.61 } });
    expect(verifyBadge(v)).toBe("VERIFIED");
    const bad = await verifyRepair(okFetch({ verified: false, status: "not_verified", delta: 2.6, message: "No." }), LOADED_BRIDGE, proposal, { node: "C", volts: 0 });
    expect(verifyBadge(bad)).toBe("HYPOTHESIZED");
    expect(verifyBadge(null)).toBe("HYPOTHESIZED");
    expect(verifyBadge({ ...v, status: "not_verified" })).toBe("HYPOTHESIZED");
    expect(verifyNarration(bad)).toBe("No.");
  });
  it("diff rows mark measured vs simulated and repair gate", () => {
    const rows = nodeDiffs(proposal, [{ node: "C", volts: 0 }]);
    expect(rows.find((r) => r.node === "C")).toMatchObject({ measured: 0, after: 2.6089 });
    expect(rows.find((r) => r.node === "A")!.measured).toBeNull();
    expect(repairReady({ hypotheses: [{ probability: 0.49 }], done: false })).toBe(false);
    expect(repairReady({ hypotheses: [{ probability: 0.5 }], done: false })).toBe(true);
    expect(repairReady({ hypotheses: [{ probability: 0.1 }], done: true })).toBe(true);
    expect(repairReady(null)).toBe(false);
  });
});

describe("bridge with the real probe engine", () => {
  it("C=0 then A=7.533 makes R6 open the leader", () => {
    const p = probeStep(LOADED_BRIDGE, [{ node: "C", volts: 0 }, { node: "A", volts: 7.533 }]);
    expect(p.hypotheses[0].id).toBe("R6:open");
  });
});
