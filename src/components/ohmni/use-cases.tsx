import { GraduationCap, Wrench, FlaskConical, CircuitBoard } from "lucide-react";

const audiences = [
  { icon: GraduationCap, title: "Students & educators", description: "Understand circuits, verify calculations and learn from discrepancies.", status: "Current limited use case", available: true },
  { icon: CircuitBoard, title: "Makers & hobbyists", description: "Compare a low-voltage prototype with expected electrical behavior.", status: "Current limited use case", available: true },
  { icon: FlaskConical, title: "Research & R&D labs", description: "Explore repeatable investigations, measurement provenance and design comparisons.", status: "Future applications", available: false },
  { icon: Wrench, title: "Technicians & hardware teams", description: "Work toward guided fault isolation, repair workflows and manufacturing diagnostics.", status: "Future applications", available: false },
];

export function UseCases() {
  return <section id="use-cases" className="use-cases-section" aria-labelledby="use-cases-heading">
    <div className="showcase-heading">
      <div><span className="eyebrow">THE PEOPLE BEHIND THE CIRCUITS</span><h2 id="use-cases-heading">Built for the people who build, test, and fix.</h2></div>
      <p>Start with readable schematics and low-voltage DC circuits. Grow toward the teams that investigate hardware every day.</p>
    </div>
    <div className="use-cases-grid">{audiences.map(({ icon: Icon, title, description, status, available }) => <article className="use-case-card" key={title}>
      <Icon size={24} aria-hidden="true" /><h3>{title}</h3><p>{description}</p><span className={`audience-status ${available ? "available" : "future"}`}>{status}</span>
    </article>)}</div>
    <p className="use-cases-scope">Today’s analysis supports resistors and DC voltage sources in reviewed circuit graphs. Industrial boards, complex PCBs and manufacturing-grade diagnosis are future work.</p>
  </section>;
}
