import type { Metadata } from "next";
import { LearnClient } from "./learn-client";

export const metadata: Metadata = {
  title: "Ohmni Learn | Explore a real voltage divider",
  description: "A guided electrical-engineering lesson using deterministic circuit calculations, not generated answers.",
};

export default function LearnPage() {
  return <LearnClient />;
}