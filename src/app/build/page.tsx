import type { Metadata } from "next";
import { BuildClient } from "./build-client";

export const metadata: Metadata = {
  title: "Ohmni Build | Engineering investigation",
  description: "Investigate an interconnected DC resistor bridge with real solver predictions and evidence-driven probe recommendations.",
};

export default function BuildPage() {
  return <BuildClient />;
}