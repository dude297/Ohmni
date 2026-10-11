import type { Metadata } from "next";
import { VoiceLab } from "./voice-lab";

export const metadata: Metadata = {
  title: "Voice Lab (experimental) | Ohmni",
  description: "Hands-free probing: push-to-talk readings, explicit confirmation, replies grounded in the circuit solver.",
};

export default function VoiceLabPage() {
  return <VoiceLab />;
}
