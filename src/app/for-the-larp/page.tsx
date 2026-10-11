import type { Metadata } from "next";
import { UnderTheHood } from "./under-the-hood";

export const metadata: Metadata = {
  title: "Under the Hood | Ohmni",
  description: "FOR THE LARP: every prediction has a provenance. Recorded model traces and live, in-browser circuit math.",
};

export default function ForTheLarpPage() {
  return <UnderTheHood />;
}
