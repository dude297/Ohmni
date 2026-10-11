import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  ArrowUpRight,
  ScanLine,
  Network,
  Activity,
} from "lucide-react";
import { Brand } from "../components/ohmni/brand";
import { HeroCircuit } from "../components/ohmni/hero-circuit";
import { LaunchShowcase } from "../components/ohmni/launch-showcase";
import { ScrollExperience } from "../components/ohmni/scroll-experience";

export const metadata: Metadata = {
  title: "Ohmni | Understand your circuit",
  description:
    "From a circuit photo to a testable diagnosis. Review connections, compare measurements and understand the electrical behavior.",
};

export default function Home() {
  return (
    <div className="ohmni home-page">
      <ScrollExperience />
      <header className="site-header">
        <Brand />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/lab" className="nav-cta">
            Open workspace <ArrowUpRight size={15} />
          </Link>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="hero-kicker">
              <span className="tiny-dot" /> A LITTLE CLARITY. A BETTER CIRCUIT.
            </div>
            <h1>
              Your circuit
              <br />
              has a problem.
              <br />
              <span>Find out why.</span>
            </h1>
            <p>
              From a clear circuit schematic to a testable diagnosis—through intelligent
              model routing, human review and verified electrical analysis.
            </p>
            <div className="hero-actions">
              <Link href="/lab?sample=divider" className="button primary">
                Try sample circuit <ArrowRight size={18} />
              </Link>
              <Link href="/lab?upload=1" className="button secondary">
                Upload your schematic <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="hero-footnote">
              <span>No signup.</span> Review the circuit. Trust the math.
            </div>
          </div>
          <div className="hero-visual">
            <div className="orbit-label">FROM “WHY?” TO “HERE’S WHY.”</div>
            <HeroCircuit />
            <div className="visual-footnote">
              <span>01 / VOLTAGE DIVIDER</span>
              <span>5 V · DC · 3 COMPONENTS</span>
            </div>
          </div>
        </section>
        <section id="how-it-works" className="method">
          <div className="method-heading">
            <span className="eyebrow">A WORKFLOW, NOT A GUESS</span>
            <h2>
              See it. Check it.
              <br />
              Make sense of it.
            </h2>
            <p>
              AI reads the image. You confirm the connections. Deterministic
              analysis checks the electrical behavior.
            </p>
          </div>
          <div className="method-cards">
            {[
              {
                icon: ScanLine,
                n: "01",
                title: "Capture the circuit",
                text: "Upload a schematic or start with a sample. Uncertain connections stay visible.",
              },
              {
                icon: Network,
                n: "02",
                title: "Review what matters",
                text: "Inspect nodes and component values before giving the solver the go-ahead.",
              },
              {
                icon: Activity,
                n: "03",
                title: "Measure. Compare. Learn.",
                text: "Compare your reading with the prediction and choose a concrete next measurement.",
              },
            ].map(({ icon: Icon, n, title, text }) => (
              <article key={n}>
                <div className="method-card-top">
                  <Icon size={23} />
                  <span>{n}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>
        <LaunchShowcase />
        <section className="closing-cta">
          <div>
            <span className="eyebrow">LESS GUESSWORK. MORE UNDERSTANDING.</span>
            <h2>Bring your “that’s weird.”</h2>
          </div>
          <Link href="/lab?sample=divider" className="button primary">
            Let’s work it out <ArrowRight size={18} />
          </Link>
        </section>
      </main>
      <footer className="site-footer">
        <Brand />
        <p>
          For learning and low-voltage prototyping. Never inspect energized
          hazardous circuits.
        </p>
        <span>BUILT FOR THE CURIOUS.</span>
      </footer>
    </div>
  );
}
