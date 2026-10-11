import type { Metadata } from "next";
import { ProbeClient } from "./probe-client";

export const metadata: Metadata = {
  title: "Probe Guide | Ohmni",
  description: "One wrong reading doesn't tell you which part failed. Ohmni tells you where to probe next.",
};

export default function ProbePage() {
  return <ProbeClient />;
}
