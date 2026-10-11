import Link from "next/link";
import { ArrowUpRight, ChevronDown } from "lucide-react";

export function SiteNavigation() {
  return (
    <nav aria-label="Main navigation">
      <a href="#use-cases">Use cases</a>
      <a href="#how-it-works">How it works</a>
      <details className="nav-more">
        <summary>More <ChevronDown size={13} aria-hidden="true" /></summary>
        <div className="nav-more-links">
          <Link href="/probe">Probe Guide <ArrowUpRight size={13} aria-hidden="true" /></Link>
          <Link href="/for-the-larp">Under the Hood <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
      </details>
      <Link className="nav-cta" href="/lab">Open lab <ArrowUpRight size={14} aria-hidden="true" /></Link>
    </nav>
  );
}
