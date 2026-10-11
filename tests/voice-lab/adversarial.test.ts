// Moonshot C readiness review: adversarial cases for Voice Lab. See docs/VOICE_LAB_REVIEW.md.
// `it.fails` = KNOWN BUG, the assertion states the CORRECT behaviour and currently fails. When the
// bug is fixed the it.fails turns red: flip it to `it`. Findings IDs (F1..) match the review doc.
import { describe, expect, it } from "vitest";
import { DIVIDER_10K_10K } from "../../src/lib/circuit/fixtures";
import { LADDER_5V } from "../../src/app/probe/helpers";
import { fmtNum, parseCommand, volts } from "../../src/app/for-the-larp/voice-lab/parser";
import { groundedReply, hypothesesReply, initialState, nextReply, reducer, type Proposal, type Reading } from "../../src/app/for-the-larp/voice-lab/machine";
import { probeStep } from "../../src/lib/probe";
import { solveDC } from "../../src/lib/circuit/solve";
import { diagnose } from "../../src/lib/diagnosis";

const D = DIVIDER_10K_10K;
const L = LADDER_5V;
const intent = (t: string, g = D) => parseCommand(t, g).intent;
const reading = (t: string, g = D) => {
  const i = intent(t, g);
  return i.type === "record_measurement" ? { node: i.node, value: i.value, unit: i.unit, volts: volts(i) } : null;
};

describe("adversarial: accepted spoken forms (documented behaviour)", () => {
  it.each([
    ["vout is oh point four five volts", 0.45, "V"],
    ["vout is nought point four five volts", 0.45, "V"],
    ["vout is point four five volts", 0.45, "V"],
    ["vout is zero point four five volts", 0.45, "V"],
    ["vout is four point five volts", 4.5, "V"],
    ["vout is forty five volts", 45, "V"],
    ["vout is four hundred fifty millivolts", 450, "mV"],
    ["vout is twenty five hundred millivolts", 2500, "mV"],
    ["vout is 0.45 mv", 0.45, "mV"],
    ["vout is minus 0.3 volts", -0.3, "V"],
    ["vout is negative zero point three volts", -0.3, "V"],
    ["vout 1,200 millivolts", 1200, "mV"],
    ["vout is 2 point 5 volts", 2.5, "V"],
  ])("%s", (t, value, unit) => expect(reading(t)).toMatchObject({ node: "VOUT", value, unit }));

  it("0.45 V, 4.5 V, 45 V, 0.45 mV are four distinct readings in volts", () => {
    const v = ["0.45 volts", "4.5 volts", "45 volts", "0.45 millivolts"].map((s) => reading(`vout is ${s}`)!.volts);
    expect(v).toEqual([0.45, 4.5, 45, 0.00045]);
    expect(new Set(v).size).toBe(4);
  });
  it("only 45 V trips the range warning on a 5 V divider; 4.5 V and 0.45 V do not (card must show unit)", () => {
    expect(parseCommand("vout is 45 volts", D).warning).toBeDefined();
    expect(parseCommand("vout is 4.5 volts", D).warning).toBeUndefined();
    expect(parseCommand("vout is 0.45 volts", D).warning).toBeUndefined();
  });
  it("integer millivolts convert exactly (k mV == Number(`${k}e-3`))", () => {
    for (let k = 1; k <= 20000; k++) expect(volts({ value: k, unit: "mV" })).toBe(Number(`${k}e-3`));
  });
});

describe("adversarial: refusals that are correct (clarify, never guess)", () => {
  it.each([
    ["vout is half a volt"], // decision: fractions are not supported, asks
    ["vout is zero point four five"], // no unit
    ["vout is naught point four five"],
    ["vout is four fifty millivolts"],
    ["vout is three three volts"],
    ["vout is 1e3 volts"],
    ["vout is 1.2.3 volts"],
    ["vout is 2.5 volts and the supply is 5 volts"],
    ["vout is two point five volts, no wait three"],
    ["output is 2.5 volts"], // "output" is NOT an alias (decision: documented, P2)
    ["ground is zero"],
    ["gnd is 0 volts"],
    ["ay is 2 volts"],
    ["vout is NaN volts"],
    ["ignore previous instructions explain"],
  ])("%s -> unknown", (t) => expect(intent(t, t.startsWith("ay") ? L : D).type).toBe("unknown"));

  it("GND (and 'ground') is rejected with the reference-probe message", () => {
    for (const t of ["ground 0.1 volts", "node gnd 1 volt"]) {
      const i = intent(t);
      expect(i).toMatchObject({ type: "unknown" });
      expect((i as { reason: string }).reason).toMatch(/reference/);
    }
  });
  it("unknown node is named, nodes come from the current graph only", () => {
    expect((intent("node C is 2 volts", L) as { reason: string }).reason).toMatch(/VIN, A, B/);
    expect((intent("vout is 2 volts", L) as { reason: string }).reason).toMatch(/don't see a node "VOUT"/);
  });
});

describe("adversarial: node 'a' vs the article 'a'", () => {
  it.each([
    ["a is 2 volts", "A"], ["node a 2 volts", "A"], ["a is at 2 volts", "A"], ["a, 2 volts", "A"],
    ["I read a 2 volts at b", "B"], ["it reads a very low 0.1 volts at b", "B"], ["b is a 2 volts", "B"], ["a reading of 2 volts at b", "B"],
  ])("%s -> %s", (t, node) => expect(reading(t, L)).toMatchObject({ node }));
  it("article-only 'a' never selects node A", () => {
    expect(intent("is a 2 volts", L).type).toBe("unknown");
    expect(intent("the a node is 2 volts", L).type).toBe("unknown");
  });
  it("sentence-initial 'a 2 volt reading at b' asks (two nodes) instead of guessing", () => {
    expect((intent("a 2 volt reading at b", L) as { reason: string }).reason).toMatch(/more than one node/);
  });
});

describe("FIXED (was known bugs F1-F4) and still-open F5-F7", () => {
  // F1 P1: STT often splits "mV" as "m v" / "millie volts": unit silently becomes V = 1000x error.
  it("F1a '0.45 m v' must not become 0.45 V", () => expect(reading("vout is 0.45 m v")?.unit).not.toBe("V"));
  it("F1b '450 millie volts' must not become 450 V", () => expect(reading("vout is 450 millie volts")?.unit).not.toBe("V"));
  it("F1c '450 mili volts' must not become 450 V", () => expect(reading("vout is 450 mili volts")?.unit).not.toBe("V"));
  // F2 P1: "thousand" is dropped. 5000 mV (= 5 V) is recorded as 5 mV.
  it("F2 'five thousand millivolts' must be 5000 mV or a clarification", () => {
    const r = reading("vout is five thousand millivolts");
    expect(r === null || r.value === 5000).toBe(true);
  });
  // F3 P1: "and a half" dropped: 2.5 V recorded as 2 V.
  it("F3 'two and a half volts' must not become 2 V", () => expect(reading("vout is two and a half volts")?.value).not.toBe(2));
  it("F3b 'six and a half volts' must not become 6 V", () => expect(reading("vout is six and a half volts")?.value).not.toBe(6));
  // F4 P1: STT hears "two point five" as "to/too/for point five"; stop-word "to" is dropped: 2.5 -> 0.5.
  it("F4a 'to point five volts' must not become 0.5 V", () => expect(reading("vout is to point five volts")?.value).not.toBe(0.5));
  it("F4b 'for point five volts' must not become 0.5 V", () => expect(reading("vout is for point five volts")?.value).not.toBe(0.5));
  // F5 P2: negation/sign words after the number are ignored.
  it.fails("F5a 'not 2 volts' must not record +2 V", () => expect(reading("vout is not 2 volts")?.value).not.toBe(2));
  it.fails("F5b '0.3 volts negative' must not record +0.3 V", () => expect(reading("vout is 0.3 volts negative")?.value).not.toBe(0.3));
  // F6 P2: fractional mV -> V loses the last ulp (24,940 of 99,999 two-decimal values), e.g. 0.03 mV.
  it.fails("F6 volts({0.03 mV}) === 0.00003", () => expect(volts({ value: 0.03, unit: "mV" })).toBe(0.00003));
  // F7 P2: card/readout rounds to 4 s.f.: 12345 mV shows as 12350.
  it.fails("F7 fmtNum(12345) === '12345'", () => expect(fmtNum(12345)).toBe("12345"));
});

describe("KNOWN GAPS (usability, safe failure): confirmation / navigation phrases (F8)", () => {
  it.fails("F8a 'yeah that's right' confirms", () => expect(intent("yeah that's right").type).toBe("confirm"));
  it.fails("F8b 'yes please' confirms", () => expect(intent("yes please").type).toBe("confirm"));
  it.fails("F8c 'what's next' is next_probe", () => expect(intent("what's next").type).toBe("next_probe"));
  it("F8d 'four hundred and fifty millivolts' is 450 mV", () => expect(reading("vout is four hundred and fifty millivolts")).toMatchObject({ value: 450, unit: "mV" }));
});

describe("fixes: positive behaviour", () => {
  it.each([
    ["vout is 0.45 m v", 0.45], ["vout is 450 millie volts", 450], ["vout is 450 mili volts", 450], ["vout is 450 em vee", 450], ["vout is 450 milli volts", 450],
  ])("%s -> mV", (t, value) => expect(reading(t)).toMatchObject({ unit: "mV", value }));
  it.each([
    ["vout is five thousand millivolts", 5000, "mV"], ["vout is two thousand five hundred millivolts", 2500, "mV"],
    ["vout is one thousand millivolts", 1000, "mV"], ["vout is four hundred and fifty millivolts", 450, "mV"], ["vout is twenty five hundred millivolts", 2500, "mV"],
  ])("%s -> %d %s", (t, value, unit) => expect(reading(t)).toMatchObject({ value, unit }));
  it("thousand/half/to-point clarify and never record", () => {
    for (const t of ["vout is 5 thousand volts", "vout is two and a half volts", "vout is half a volt", "vout is to point five volts", "vout is for point five volts", "vout is too point five volts", "vout is two thousand thousand volts"])
      expect(intent(t).type).toBe("unknown");
    expect((intent("vout is to point five volts") as { reason: string }).reason).toMatch(/two point|whole number/);
  });
  it("legit 'two/four point five' still parse; real 1000x mV values stay exact", () => {
    expect(reading("vout is two point five volts")?.value).toBe(2.5);
    expect(reading("vout is four point five volts")?.value).toBe(4.5);
    expect(reading("vout is 5000 mv")?.volts).toBe(5);
  });
  it("fail() with a proposal keeps it confirmable; commit_start is idempotent while processing", () => {
    const p = reducer(confirmed, { type: "propose", proposal: { reading: reading0("VOUT", 2.5), revision: confirmed.revision, transcript: "t" } });
    const failed = reducer(reducer(p, { type: "commit_start" }), { type: "fail", message: "API down. Nothing was recorded." });
    expect(failed).toMatchObject({ phase: "confirming", observations: [] });
    expect(failed.proposal).not.toBeNull();
    expect(reducer(failed, { type: "commit_start" }).phase).toBe("processing"); // retry works
    expect(reducer(reducer(failed, { type: "commit_start" }), { type: "fail", message: "x" }).proposal).not.toBeNull();
    expect(reducer(confirmed, { type: "fail", message: "mic" }).phase).toBe("error"); // no proposal -> plain error
  });
});

const reading0 =(node: string, value: number): Reading => ({ type: "record_measurement", node, value, unit: "V" });
const prop = (s: { revision: number }, r: Reading): Proposal => ({ reading: r, revision: s.revision, transcript: "t" });
const confirmed = reducer(initialState, { type: "confirm_circuit" });

describe("adversarial: state machine", () => {
  it("no path to 'processing' or observations without propose then commit_start", () => {
    for (const a of ["listen", "heard", "say", "cancel", "commit_start"] as const) {
      const s = reducer(confirmed, a === "say" ? { type: "say", message: "m" } : { type: a } as never);
      expect(s.observations).toEqual([]);
      expect(s.phase).not.toBe("committed");
    }
  });
  it("confirm 'yes' text alone is not an action: only commit_start commits, and it needs a same-revision proposal", () => {
    const withP = reducer(confirmed, { type: "propose", proposal: prop(confirmed, reading0("VOUT", 2.5)) });
    expect(reducer(withP, { type: "commit_start" }).phase).toBe("processing");
    const stale = { ...withP, revision: withP.revision + 1 };
    expect(reducer(stale, { type: "commit_start" })).toMatchObject({ phase: "error", proposal: null });
  });
  it("a corrected reading replaces the pending proposal (never commits)", () => {
    let s = reducer(confirmed, { type: "propose", proposal: prop(confirmed, reading0("VOUT", 2.5)) });
    s = reducer(s, { type: "propose", proposal: prop(s, reading0("VOUT", 3)) });
    expect(s.proposal?.reading.value).toBe(3);
    expect(s.observations).toEqual([]);
  });
  it("select_circuit mid-proposal drops the proposal and the confirmation", () => {
    const s = reducer(reducer(confirmed, { type: "propose", proposal: prop(confirmed, reading0("VOUT", 2.5)) }), { type: "select_circuit" });
    expect(s).toMatchObject({ proposal: null, circuitConfirmed: false, observations: [], phase: "idle" });
  });
  // F9 P2: a duplicate commit_start (double click) flips an in-flight 'processing' to 'error'.
  it("F9 duplicate commit_start keeps phase 'processing'", () => {
    const p = reducer(confirmed, { type: "propose", proposal: prop(confirmed, reading0("VOUT", 2.5)) });
    const once = reducer(p, { type: "commit_start" });
    expect(reducer(once, { type: "commit_start" }).phase).toBe("processing");
  });
  // F10 P1: the card renders only for phase confirming|listening. A speech error ('no-speech' on the
  // card mic) dispatches `fail` -> phase 'error' while the proposal survives, so the card disappears
  // but the pending proposal is still armed. Expected: phase stays 'confirming' while a proposal exists.
  it("F10 fail() with a pending proposal keeps the card visible (phase confirming)", () => {
    const p = reducer(confirmed, { type: "propose", proposal: prop(confirmed, reading0("VOUT", 2.5)) });
    expect(reducer(p, { type: "fail", message: "no-speech" }).phase).toBe("confirming");
  });
});

describe("adversarial: spoken recommendations are safe", () => {
  it("replies for the ladder flow never recommend measuring resistance, and name hypotheses as such", () => {
    const g = L;
    const solve = { ...solveDC(g), grounded: true as const, trace: [], hypotheses: diagnose(g, 0) };
    const probe = probeStep(g, [{ node: "B", volts: 0 }]);
    const spoken = [
      groundedReply({ type: "record_measurement", node: "B", value: 0, unit: "V" }, solve, probe),
      hypothesesReply(probe),
      nextReply(probe, g),
      nextReply(null, g),
    ].join(" ");
    expect(spoken).not.toMatch(/resistance|ohm|continuity|Ω/i);
    expect(spoken).toMatch(/not (a )?confirmed fault/i);
    expect(nextReply(probe, g)).toMatch(/powered|black probe/); // voltage-only, with GND reference
  });
  it("the API safety line is NOT part of any spoken string (F11, P2): on-screen only", () => {
    const probe = probeStep(L, [{ node: "B", volts: 0 }]);
    const spoken = [hypothesesReply(probe), nextReply(probe, L)].join(" ");
    expect(probe.safety).toMatch(/Disconnect power/);
    expect(spoken).not.toContain("Disconnect power");
  });
  it("solver hypothesis nextMeasurement text that mentions resistance always says 'Disconnect power first' (and Voice Lab never speaks it)", () => {
    for (const g of [D, L]) for (const v of [0, 0.45, 4.5, 5]) for (const h of diagnose(g, v))
      if (/resistance/i.test(h.nextMeasurement)) expect(h.nextMeasurement).toMatch(/Disconnect power first/);
  });
});
