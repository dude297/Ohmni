import type { Metadata } from "next";
import { StudioClient } from "./studio-client";

export const metadata: Metadata = {
  title: "Circuit Studio | Ohmni",
  description: "Interactive 3D breadboard studio: wire a build, see the net split, fix it, and check the simulated result.",
};

export default function StudioPage() {
  return <StudioClient />;
}
