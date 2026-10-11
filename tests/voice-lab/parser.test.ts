import { describe, expect, it } from "vitest";
import { DIVIDER_10K_10K, SERIES_PARALLEL_12V } from "../../src/lib/circuit/fixtures";
import { LADDER_5V } from "../../src/app/probe/helpers";
import { parseCommand, volts } from "../../src/app/for-the-larp/voice-lab/parser";

const rec = (text: string, g = DIVIDER_10K_10K) => {
  const p = parseCommand(text, g);
  if (p.intent.type !== "record_measurement") throw new Error(`expected reading, got ${JSON.stringify(p.intent)}`);
  return { ...p.intent, volts: volts(p.intent), warning: p.warning };
};
const reason = (text: string, g = DIVIDER_10K_10K) => {
  const p = parseCommand(text, g);
  if (p.intent.type !== "unknown") throw new Error(`expected unknown, got ${JSON.stringify(p.intent)}`);
  return p.intent.reason;
};

describe("voice-lab parser: magnitudes", () => {
  it("distinguishes 0.45 V, 4.5 V, 45 V and 0.45 mV", () => {
    expect(rec("VOUT is 0.45 volts")).toMatchObject({ node: "VOUT", value: 0.45, unit: "V", volts: 0.45 });
    expect(rec("VOUT is 4.5 volts")).toMatchObject({ value: 4.5, unit: "V", volts: 4.5 });
    expect(rec("VOUT is 45 volts")).toMatchObject({ value: 45, unit: "V" });
    expect(rec("VOUT is 0.45 millivolts")).toMatchObject({ value: 0.45, unit: "mV", volts: 0.00045 });
  });
  it("converts millivolts to volts", () => {
    expect(rec("vout 450 mV").volts).toBeCloseTo(0.45, 12);
    expect(rec("vout 450mV").volts).toBeCloseTo(0.45, 12);
    expect(rec("four hundred fifty millivolts at v out").volts).toBeCloseTo(0.45, 12);
    expect(rec("vout is 2500 milli volts")).toMatchObject({ unit: "mV", value: 2500, volts: 2.5 });
  });
  it("parses spoken numbers", () => {
    expect(rec("vout is point four five volts").value).toBe(0.45);
    expect(rec("vout is zero point four five volts").value).toBe(0.45);
    expect(rec("vout is four point five volts").value).toBe(4.5);
    expect(rec("vout is forty five volts").value).toBe(45);
    expect(rec("vout is forty-five volts").value).toBe(45);
    expect(rec("vout is two point five volts").value).toBe(2.5);
    expect(rec("vout is 4 point 5 volts").value).toBe(4.5);
    expect(rec("vout is point forty five volts").value).toBe(0.45);
    expect(rec("vout is minus one point two volts").value).toBe(-1.2);
    expect(rec("B is zero volts", LADDER_5V)).toMatchObject({ node: "B", value: 0 });
    expect(rec("node A five volts", LADDER_5V)).toMatchObject({ node: "A", value: 5, unit: "V" });
    expect(rec("0.45V at vout").value).toBe(0.45);
  });
  it("flags out-of-range values instead of silently accepting", () => {
    expect(rec("VOUT is 45 volts").warning).toMatch(/check your range/i);
    expect(rec("VOUT is 4.5 volts").warning).toBeUndefined();
    expect(rec("MID is 13.5 volts", SERIES_PARALLEL_12V).warning).toMatch(/check your range/i);
    expect(rec("MID is 13 volts", SERIES_PARALLEL_12V).warning).toBeUndefined();
  });
});

describe("voice-lab parser: nodes", () => {
  it("resolves aliases only against the current graph", () => {
    expect(rec("vee out is 2.5 volts").node).toBe("VOUT");
    expect(rec("V-OUT 2.5 V").node).toBe("VOUT");
    expect(rec("v in reads 5 volts").node).toBe("VIN");
    expect(rec("node a is 3.3 volts", LADDER_5V).node).toBe("A");
    expect(rec("I got a reading of 2 volts at b", LADDER_5V).node).toBe("B");
    expect(rec("mid is 6.5 volts", SERIES_PARALLEL_12V).node).toBe("MID");
  });
  it("rejects unknown nodes with a clarification question", () => {
    expect(reason("node C is 2 volts", LADDER_5V)).toMatch(/don't see a node "C".*VIN, A, B/);
    expect(reason("A is 2 volts")).toMatch(/don't see a node "A"/); // divider has no A
    expect(reason("vout is 2 volts", LADDER_5V)).toMatch(/Which node/);
  });
  it("rejects ground as the measured node", () => {
    expect(reason("ground is 0 volts")).toMatch(/reference/);
  });
});

describe("voice-lab parser: ambiguity is never guessed", () => {
  it("asks on 'four five', two numbers, missing unit, missing node, both units", () => {
    expect(reason("vout is four five volts")).toMatch(/ambiguous/);
    expect(reason("vout is 2 or 3 volts")).toMatch(/more than one number/);
    expect(reason("vout 0.45")).toMatch(/volts or .* millivolts/);
    expect(reason("0.45 volts")).toMatch(/Which node/);
    expect(reason("vout 2 volts 300 millivolts")).toMatch(/more than one number|both/);
    expect(reason("vout and vin are 2 volts")).toMatch(/more than one node/);
    expect(reason("vout is volts")).toMatch(/didn't catch a number/);
  });
  it("zero needs no unit", () => {
    expect(rec("vout is zero")).toMatchObject({ value: 0, unit: "V" });
  });
});

describe("voice-lab parser: commands", () => {
  it.each([
    ["yes", "confirm"], ["Correct.", "confirm"], ["no", "cancel"], ["cancel", "cancel"],
    ["repeat", "repeat"], ["say that again", "repeat"], ["next", "next_probe"], ["where should I probe next?", "next_probe"],
    ["explain", "explain_result"], ["why", "explain_result"], ["show hypotheses", "show_hypotheses"], ["what's wrong", "show_hypotheses"],
  ])("%s -> %s", (t, type) => expect(parseCommand(t, DIVIDER_10K_10K).intent.type).toBe(type));
  it("gibberish is unknown", () => expect(parseCommand("banana", DIVIDER_10K_10K).intent.type).toBe("unknown"));
});
