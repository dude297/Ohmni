import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Brand } from "../components/ohmni/brand";
import { HeroCircuit } from "../components/ohmni/hero-circuit";
import { ScrollExperience } from "../components/ohmni/scroll-experience";
import { UseCases } from "../components/ohmni/use-cases";
import { SiteNavigation } from "../components/ohmni/site-navigation";

export const metadata: Metadata = {title: "Ohmni | The living schematic", description: "Review a circuit. Compare a measurement. Find your next experiment."};
export default function Home() {
 return <div className="ohmni home-page living-home">
  <ScrollExperience/>
  <header className="site-header"><Brand/><SiteNavigation/></header>
  <main>
   <section className="hero">
    <div className="hero-copy">
     <div className="hero-kicker"><span className="tiny-dot"/> THE LIVING SCHEMATIC</div>
     <h1>Circuits,<br/><span>made clear.</span></h1>
     <p>Turn a schematic and a meter reading into an investigation. Review the connections, compare real calculations, and choose your next experiment.</p>
     <div className="hero-actions"><Link href="/lab?sample=advanced" className="button primary">Try Ohmni <ArrowRight size={18}/></Link></div>
     <div className="hero-footnote"><Link href="/lab?sample=divider">Start with the beginner divider →</Link></div>
    </div>
    <div className="hero-visual"><div className="orbit-label">01 / CHANGE ONE PART. SEE THE CIRCUIT RESPOND.</div><HeroCircuit/><div className="visual-footnote"><span>TUTORIAL · LOCAL DIVIDER PREVIEW</span><span>ADVANCED BRIDGE IN LAB →</span></div></div>
   </section>
   <section id="how-it-works" className="living-method"><div className="eyebrow">THE INVESTIGATION</div><h2>Every reading moves you forward.</h2><ol>{["Capture","Review & confirm","Compare","Investigate"].map((step,i)=><li key={step}><span>0{i+1}</span><strong>{step}</strong>{i<3&&<ArrowRight size={18} aria-hidden="true"/>}</li>)}</ol><p>Prepared examples are labelled. Uploaded schematics require your confirmation. Predictions and hypotheses stay distinct from measurements.</p></section>
   <UseCases/>
  </main>
  <footer className="site-footer"><Brand/><p>Low-voltage DC only. Disconnect power before checking resistance. Hypotheses require physical verification.</p><Link href="/for-the-larp">Inspect the engineering →</Link></footer>
 </div>;
}
