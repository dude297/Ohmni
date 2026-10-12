import type { Metadata } from "next";
import { MultiFaultClient } from "./multi-fault-client";

export const metadata: Metadata = {
  title: "Multi-fault Diagnosis | Ohmni",
  description: "Ranked fault-pair hypotheses from node voltage readings.",
};

export default function MultiFaultPage() {
  return <MultiFaultClient />;
}
