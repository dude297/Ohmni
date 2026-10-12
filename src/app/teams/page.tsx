import type { Metadata } from "next";
import { TeamsClient } from "./teams-client";

export const metadata: Metadata = {
  title: "Team Review | Ohmni",
  description: "Browser-only engineering review of an Ohmni evidence packet.",
};

export default function TeamsPage() {
  return <TeamsClient />;
}
