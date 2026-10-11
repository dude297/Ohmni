import { Suspense } from "react";
import type { Metadata } from "next";
import { LabWorkspace } from "../../components/ohmni/lab-workspace";

export const metadata: Metadata = {
  title: "Circuit workspace | Ohmni",
  description:
    "Capture, review and analyze a low-voltage DC circuit with explicit confirmation and transparent results.",
};

export default function LabPage() {
  return (
    <Suspense
      fallback={
        <main className="ohmni loading-page">Opening your workspace…</main>
      }
    >
      <LabWorkspace />
    </Suspense>
  );
}
