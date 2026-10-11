import { describe, expect, it } from "vitest";
import { maxStage, STAGES } from "../../src/components/ohmni/stages";

const base = { hasGraph: true, confirmed: true, reviewReady: true, hasResult: true };
describe("guided lab stage gating", () => {
  it("has four stages", () => expect(STAGES.map((s) => s.title)).toEqual(["Capture", "Review", "Compare", "Investigate"]));
  it("needs a graph to leave Capture", () => expect(maxStage({ ...base, hasGraph: false })).toBe(0));
  it("blocks Compare until confirmed", () => expect(maxStage({ ...base, confirmed: false, hasResult: false })).toBe(1));
  it("blocks Compare while ask_user issues are unresolved", () => expect(maxStage({ ...base, reviewReady: false })).toBe(1));
  it("blocks Investigate without a result", () => expect(maxStage({ ...base, hasResult: false })).toBe(2));
  it("opens Investigate with a confirmed result", () => expect(maxStage(base)).toBe(3));
});
