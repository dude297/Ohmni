"use client";

import { useMemo, useState } from "react";
import { resistorBands } from "./_bands";
import { holePos } from "./_geometry";
import { allHoles, type HoleId } from "./_model";
import { occupant } from "./_state";
import type { BoardProps } from "./_view";

const holes = allHoles();
const DIRS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Keyboard-accessible top view: arrow keys move between holes, Enter/Space clicks. */
export function Board2D({ state, dispatch, netHoles, faultHoles }: BoardProps) {
  const [focus, setFocus] = useState<HoleId>("a1");
  const net = useMemo(() => new Set(netHoles), [netHoles]);
  const fault = useMemo(() => new Set(faultHoles), [faultHoles]);
  const sel = state.selection;
  const { build } = state;
  const P = (h: HoleId) => holePos(h)!;

  const onKey = (e: React.KeyboardEvent<SVGGElement>, h: HoleId) => {
    const d = DIRS[e.key];
    if (d) {
      e.preventDefault();
      const p = P(h);
      let best: HoleId | null = null;
      let bs = Infinity;
      for (const o of holes) {
        if (o === h) continue;
        const q = P(o);
        const along = (q.x - p.x) * d[0] + (q.z - p.z) * d[1];
        const across = Math.abs((q.x - p.x) * d[1]) + Math.abs((q.z - p.z) * d[0]);
        if (along < 0.5) continue;
        const score = along + across * 3;
        if (score < bs) {
          bs = score;
          best = o;
        }
      }
      if (best) {
        setFocus(best);
        requestAnimationFrame(() => document.querySelector<SVGGElement>(`[data-testid="hole-${best}"]`)?.focus());
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dispatch({ type: "clickHole", hole: h });
    } else if (e.key === "Escape") dispatch({ type: "cancelTool" });
  };

  const moving = state.tool.kind === "move" ? state.tool : null;
  return (
    <svg className="st-svg" viewBox="-3 -13 35 26" role="application" aria-label="Breadboard top view. Arrow keys move between holes, Enter selects or places." data-testid="board2d">
      <rect x={-2} y={-9.5} width={33} height={22} rx={0.8} fill="#ebe8dd" stroke="#b9b6a6" strokeWidth={0.1} />
      <rect x={-2} y={0.6} width={33} height={1.8} fill="#d9d5c6" />
      {Array.from({ length: 30 }, (_, i) => (
        <g key={i}>
          <rect x={i - 0.42} y={-4.45} width={0.84} height={4.9} rx={0.2} fill="#f6f5f0" />
          <rect x={i - 0.42} y={2.55} width={0.84} height={4.9} rx={0.2} fill="#f6f5f0" />
          {(i + 1) % 5 === 0 || i === 0 ? <text x={i} y={-4.8} fontSize={0.7} textAnchor="middle" fill="#53656a">{i + 1}</text> : null}
        </g>
      ))}
      {["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((r) => (
        <text key={r} x={-1.1} y={P(`${r}1`).z + 0.25} fontSize={0.7} textAnchor="middle" fill="#53656a">{r}</text>
      ))}
      {(["L+", "L-", "R+", "R-"] as const).map((r) => (
        <g key={r}>
          <line x1={-0.5} x2={30} y1={P(`${r}1`).z} y2={P(`${r}1`).z} stroke={r.endsWith("+") ? "#c0392b" : "#2f6db5"} strokeWidth={0.12} opacity={0.35} />
          <text x={-1.2} y={P(`${r}1`).z + 0.25} fontSize={0.7} textAnchor="middle" fill="#53656a">{r}</text>
        </g>
      ))}

      {holes.map((h) => {
        const p = P(h);
        const used = !!occupant(build, h);
        const cls = fault.has(h) ? "st-holeFault" : net.has(h) ? "st-holeNet" : used ? "st-holeUsed" : "st-hole";
        return (
          <g
            key={h}
            data-testid={`hole-${h}`}
            role="button"
            tabIndex={h === focus ? 0 : -1}
            aria-label={`hole ${h}${used ? ` (${occupant(build, h)})` : ""}${fault.has(h) ? ", wiring fault" : ""}`}
            onFocus={() => setFocus(h)}
            onKeyDown={(e) => onKey(e, h)}
            onClick={() => dispatch({ type: "clickHole", hole: h })}
            className="st-clickable"
          >
            {fault.has(h) && <circle className="st-ring st-pulse" cx={p.x} cy={p.z} r={0.55} />}
            <circle className={cls} cx={p.x} cy={p.z} r={net.has(h) || fault.has(h) ? 0.4 : 0.3} />
            <circle className="st-hit" cx={p.x} cy={p.z} r={0.5} />
          </g>
        );
      })}

      {/* supply */}
      {build.placements.filter((p) => p.kind === "dc_supply").map((p) => {
        const a = P(p.pins.positive);
        const b = P(p.pins.negative);
        const on = sel?.kind === "component" && sel.id === p.id;
        return (
          <g key={p.id} data-testid={`comp-${p.id}`} role="button" tabIndex={0} aria-label={`${p.id} supply ${p.value} volts`} className="st-clickable" onClick={() => dispatch({ type: "select", sel: { kind: "component", id: p.id } })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && dispatch({ type: "select", sel: { kind: "component", id: p.id } })}>
            <line x1={0} y1={-10.2} x2={a.x} y2={a.z} stroke="#c0392b" strokeWidth={0.22} />
            <line x1={3} y1={-10.2} x2={b.x} y2={b.z} stroke="#222" strokeWidth={0.22} />
            <rect x={-1.5} y={-12.4} width={6} height={2.4} rx={0.3} fill="#142c32" stroke={on ? "#f2b45a" : "none"} strokeWidth={0.3} />
            <text x={1.5} y={-11} fontSize={0.9} fill="#f6f5f0" textAnchor="middle">{p.id} {p.value} V</text>
            <text x={0} y={-10.4} fontSize={0.7} fill="#f2b45a" textAnchor="middle">+</text>
            <text x={3} y={-10.4} fontSize={0.7} fill="#f6f5f0" textAnchor="middle">−</text>
          </g>
        );
      })}

      {/* resistors */}
      {build.placements.filter((p) => p.kind === "resistor").map((p) => {
        const a = P(p.pins.positive);
        const b = P(p.pins.negative);
        const dist = Math.hypot(b.x - a.x, b.z - a.z);
        const L = Math.min(Math.max(dist - 1.2, 1.4), 3.4);
        const ang = (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI;
        const bands = resistorBands(p.value);
        const on = sel?.kind === "component" && sel.id === p.id;
        return (
          <g key={p.id} data-testid={`comp-${p.id}`} role="button" tabIndex={0} aria-label={`${p.id} resistor ${p.value} ohms`} className="st-clickable" onClick={() => dispatch({ type: "select", sel: { kind: "component", id: p.id } })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && dispatch({ type: "select", sel: { kind: "component", id: p.id } })}>
            <line x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke="#9a9a9a" strokeWidth={0.2} />
            <g transform={`translate(${(a.x + b.x) / 2} ${(a.z + b.z) / 2}) rotate(${ang})`}>
              <rect x={-L / 2 - 0.2} y={-0.8} width={L + 0.4} height={1.6} rx={0.6} fill="none" stroke={on ? "#f2b45a" : "none"} strokeWidth={0.35} />
              <rect x={-L / 2} y={-0.6} width={L} height={1.2} rx={0.5} fill="#d8c9a3" />
              {bands?.hex.map((c, i) => (
                <rect key={i} x={i < 3 ? -L / 2 + 0.35 + i * 0.4 : L / 2 - 0.65} y={-0.6} width={0.22} height={1.2} fill={c} />
              ))}
            </g>
            <text x={(a.x + b.x) / 2} y={(a.z + b.z) / 2 - 1.3} fontSize={0.8} textAnchor="middle" fill="#142c32">{p.id}</text>
          </g>
        );
      })}

      {/* jumpers: paths are decorative; the chip and ends are the targets */}
      {build.jumpers.map((j) => {
        const a = P(j.a);
        const b = P(j.b);
        const mx = (a.x + b.x) / 2;
        const lift = 1 + Math.hypot(b.x - a.x, b.z - a.z) * 0.18;
        const cz = Math.min(a.z, b.z) - lift;
        const on = sel?.kind === "jumper" && sel.id === j.id;
        const mv = moving?.jumperId === j.id;
        const d = `M${a.x} ${a.z} Q${mx} ${cz} ${b.x} ${b.z}`;
        const apex = (a.z + 2 * cz + b.z) / 4;
        return (
          <g key={j.id}>
            {on && <path d={d} fill="none" stroke="#f2b45a" strokeWidth={0.7} strokeLinecap="round" pointerEvents="none" />}
            <path d={d} fill="none" stroke={j.color ?? "#2f6db5"} strokeWidth={0.32} strokeLinecap="round" pointerEvents="none" />
            <g data-testid={`jumper-${j.id}`} role="button" tabIndex={0} aria-label={`jumper ${j.id}: ${j.a} to ${j.b}`} className="st-clickable" onClick={() => dispatch({ type: "select", sel: { kind: "jumper", id: j.id } })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && dispatch({ type: "select", sel: { kind: "jumper", id: j.id } })}>
              <rect x={mx - 0.9} y={apex - 0.5} width={1.8} height={1} rx={0.4} fill={on ? "#f2b45a" : "#fff"} stroke="#142c32" strokeWidth={0.08} />
              <text x={mx} y={apex + 0.25} fontSize={0.7} textAnchor="middle" fill="#142c32">{j.id}</text>
            </g>
            {(["a", "b"] as const).map((end) => {
              const q = end === "a" ? a : b;
              return (
                <circle
                  key={end}
                  data-testid={`jumper-${j.id}-${end}`}
                  cx={q.x}
                  cy={q.z}
                  r={on ? 0.55 : 0.2}
                  fill={mv && moving?.end === end ? "#f2b45a" : j.color ?? "#2f6db5"}
                  stroke={on ? "#142c32" : "none"}
                  strokeWidth={0.12}
                  className={on ? "st-clickable" : undefined}
                  pointerEvents={on ? "auto" : "none"}
                  onClick={on ? () => dispatch({ type: "beginMove", jumperId: j.id, end }) : undefined}
                >
                  <title>{`${j.id} end ${end.toUpperCase()} on ${end === "a" ? j.a : j.b}: click to move`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
