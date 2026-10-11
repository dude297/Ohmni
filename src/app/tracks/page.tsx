import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import s from "./tracks.module.css";

export const metadata: Metadata = {
  title: "Ohmni Workspaces | Learn · Build · Teams",
  description: "Explore Ohmni's three experimental, evidence-driven engineering workspaces.",
};

const TrackArtwork = ({ kind }: { kind: "learn" | "build" | "teams" }) => {
  if (kind === "learn") return (
    <svg viewBox="0 0 320 122" aria-hidden="true">
      <g fill="none" stroke="#8ba79f" strokeWidth="2.5"><path d="M36 58H105l12-12 12 24 12-24 12 12h51" /><path d="M36 58v47h222V58h25"/></g>
      <circle cx="204" cy="58" r="13" fill="none" stroke="#f2b45a" strokeWidth="2"/>
      <circle cx="204" cy="58" r="4" fill="#f2b45a" />
      <text x="32" y="31" fontFamily="monospace" fontSize="13" fill="#e7eeea">5.00 V</text>
      <text x="227" y="43" fontFamily="monospace" fontSize="12" fill="#f2b45a">VOUT</text>
      <text x="227" y="80" fontFamily="monospace" fontSize="17" fill="#f2b45a">2.50 V</text>
    </svg>
  );
  if (kind === "build") return (
    <svg viewBox="0 0 320 122" aria-hidden="true">
      <g fill="none" stroke="#8ba79f" strokeWidth="2.5">
        <path d="M30 24H288V96H30V24M102 24V46M102 78V96M212 24V46M212 78V96M102 61H137M174 61H212"/>
      </g>
      <g stroke="#f2b45a" strokeWidth="2" fill="#142c32"><rect x="94" y="46" width="16" height="32" rx="3"/><rect x="204" y="46" width="16" height="32" rx="3"/><rect x="137" y="54" width="37" height="14" rx="3"/></g>
      <circle cx="212" cy="96" r="7" fill="#f2b45a" />
      <text x="228" y="79" fontFamily="monospace" fontSize="12" fill="#f2b45a">PROBE</text>
    </svg>
  );
  return (
    <svg viewBox="0 0 320 122" aria-hidden="true">
      <g fill="none" stroke="#8ba79f" strokeWidth="2"><rect x="48" y="20" width="119" height="81" rx="6"/><rect x="151" y="32" width="119" height="74" rx="6"/></g>
      <path d="M169 54h70M169 66h54M169 78h62" stroke="#acc7b8" strokeWidth="4" strokeLinecap="round"/>
      <circle cx="77" cy="44" r="9" fill="#f2b45a"/>
      <path d="M68 44l6 6 11-13" stroke="#142c32" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <path d="M70 69h64M70 81h45" stroke="#acc7b8" strokeWidth="4" strokeLinecap="round"/>
    </svg>
  );
};

const tracks = [
  { key: "learn" as const, number: "01", title: "Ohmni Learn", intro: "Predict, experiment and understand what each component changes.", label: "Try a guided circuit lesson" },
  { key: "build" as const, number: "02", title: "Ohmni Build", intro: "Investigate real solver predictions and choose your next useful measurement.", label: "Open the engineering bench" },
  { key: "teams" as const, number: "03", title: "Ohmni Teams", intro: "Turn findings and evidence into an exportable engineering review packet.", label: "Prepare a review packet" },
];

export default function TracksPage() {
  return (
    <div className={s.shell}>
      <header className={s.top}>
        <Link href="/" className={s.logo} aria-label="Ohmni home">ohmni<span>.</span></Link>
        <nav className={s.topnav} aria-label="Workspace navigation">
          <Link href="/lab">Lab</Link>
          <Link href="/probe">Probe guide</Link>
        </nav>
      </header>
      <main className={s.wrap}>
        <div className={s.kicker}>Three workspaces · one electrical evidence engine</div>
        <h1 className={s.heading}>Learn the circuit.<br/><em>Build with confidence.</em><br/>Share the evidence.</h1>
        <p className={s.intro}>From first-principles learning to hardware investigation and review-ready reports. Each workspace is an experimental preview built around Ohmni's existing DC capabilities.</p>
        <div className={s.three}>
          {tracks.map((t) => (
            <Link className={s.track} href={"/" + t.key} key={t.key}>
              <div className={s.trackVisual}><span className={s.trackNumber}>{t.number} / 03</span><TrackArtwork kind={t.key}/></div>
              <div className={s.trackInfo}>
                <div className={s.eyebrow}>Workspace {t.number}</div>
                <h2>{t.title}</h2>
                <p>{t.intro}</p>
                <span className={s.open}>{t.label} <ArrowRight size={17} aria-hidden="true"/></span>
              </div>
            </Link>
          ))}
        </div>
        <div className={s.footer}>Preview workspaces. No 3D breadboard, voice-controlled Lab, multi-user collaboration, AC simulation or verified physical repair is claimed here. <Link href="/lab" className={s.link}>Open the current Lab <ArrowUpRight size={14}/></Link></div>
      </main>
    </div>
  );
}