import type { Metadata } from "next";
import { AcClient } from "./ac-client";

export const metadata: Metadata = {
  title: "AC Bode lab | Ohmni",
  description: "Frequency response from a sandboxed ngspice engine, with measured-vs-simulated fault finding.",
};

export default function AcPage() {
  return <AcClient />;
}
