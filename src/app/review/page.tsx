import type { Metadata } from "next";
import { ReviewClient } from "./review-client";

export const metadata: Metadata = {
  title: "Schematic Review | Ohmni",
  description: "Advisory rules + DC-solver review of a confirmed circuit.",
};

export default function ReviewPage() {
  return <ReviewClient />;
}
