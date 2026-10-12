import type { Metadata } from "next";
import { TwinClient } from "./twin-client";

export const metadata: Metadata = {
  title: "Digital twin | Ohmni",
  description: "Compare the circuit you designed with the one you built: what to measure, what is wrong, how to fix it, and how to verify.",
};

export default function TwinPage() {
  return <TwinClient />;
}
