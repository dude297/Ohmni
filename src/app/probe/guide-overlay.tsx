"use client";

import { useEffect } from "react";
import type { CircuitGraph } from "../../lib/circuit/types";
import type { ProbeStep } from "../../lib/probe";
import { bitsPhrase, outcomePhrase, schematicLayout } from "./helpers";

/** Lightweight schematic of the real graph; `highlight` is the node /api/probe chose. */
export function ProbeSchematic({ graph, highlight }: { graph: CircuitGraph; highlight: string | null }) {
  const { nodes, parts, width, height } = schematicLayout(graph);
  return (
    <svg className="pg-schem" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={highlight ? `Circuit schematic. Probe node ${highlight} next.` : "Circuit schematic"}>
      {parts.map((p) => {
        const mid = (p.a.y + p.b.y) / 2;
        return (
          <g key={p.id} className="pg-part">
            <path d={`M${p.a.x} ${p.a.y}H${p.laneX}V${p.b.y}H${p.b.x}`} fill="none" />
            <rect x={p.laneX - 9} y={mid - 14} width={18} height={28} rx={3} data-kind={p.kind} />
            <text x={p.laneX + 14} y={mid + 4}>{p.id}</text>
          </g>
        );
      })}
      {nodes.map((n) => {
        const on = n.name === highlight;
        return (
          <g key={n.name} data-node={n.name} data-highlight={on || undefined}>
            {on && (
              <>
                <circle className="pg-ring" cx={n.x} cy={n.y} r={14} />
                <circle className="pg-ring2" cx={n.x} cy={n.y} r={14} />
                <g className="pg-callout">
                  <rect x={8} y={n.y - 28} width={254} height={20} rx={10} />
                  <text x={20} y={n.y - 14}>Put the red probe here; black probe on GND</text>
                </g>
              </>
            )}
            <circle className={on ? "pg-dot pg-dotOn" : "pg-dot"} cx={n.x} cy={n.y} r={on ? 7 : 5} />
            <text className="pg-nlabel" x={n.x - 14} y={n.y + 4} textAnchor="end">{n.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

type Props = {
  step: ProbeStep;
  open: boolean;
  onClose: () => void;
  onEnter: () => void;
  titleOf: (ids: string[]) => string[];
};

/** Non-modal guide: Esc or "Skip guide" closes it; focus returns to the "Show guide" toggle. */
export function GuidePanel({ step, open, onClose, onEnter, titleOf }: Props) {
  const next = step.next;
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open || !next) return null;
  return (
    <aside className="pg-guide" role="dialog" aria-modal="false" aria-labelledby="pg-guide-h" aria-live="polite">
      <h3 id="pg-guide-h">Why measure {next.node}?</h3>
      <p>
        Put the red probe on <b>{next.node}</b> and the black probe on GND: {bitsPhrase(next.expectedBits)}.
      </p>
      <ul>
        {next.outcomes.slice(0, 5).map((o) => (
          <li key={o.hypothesisIds.join("|")}>{outcomePhrase(o.volts, titleOf(o.hypothesisIds), o.probability)}</li>
        ))}
      </ul>
      <p className="pg-safety">{step.safety}</p>
      <div className="pg-guideBtns">
        <button type="button" className="button primary" onClick={onEnter}>Enter reading</button>
        <button type="button" className="button secondary" onClick={onClose}>Skip guide</button>
      </div>
    </aside>
  );
}
