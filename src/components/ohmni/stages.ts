export const STAGES = [
  { title: "Capture", heading: "Capture a circuit" },
  { title: "Review", heading: "Review the extracted circuit" },
  { title: "Compare", heading: "Compare your measurement" },
  { title: "Investigate", heading: "Investigate the difference" },
] as const;

/** Furthest stage the user may open. Navigation never calls a model; gates mirror solve() preconditions. */
export function maxStage(s: { hasGraph: boolean; confirmed: boolean; reviewReady: boolean; hasResult: boolean }) {
  if (!s.hasGraph) return 0;
  if (!s.confirmed || !s.reviewReady) return 1;
  return s.hasResult ? 3 : 2;
}
