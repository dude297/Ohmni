import type { Metadata } from "next";
import { BuildClient } from "./build-client";

export const metadata: Metadata = { title: "Build bench | Ohmni", description: "Measure, diagnose, repair and verify a bench circuit." };

export default function BuildPage() {
  return <BuildClient />;
}
