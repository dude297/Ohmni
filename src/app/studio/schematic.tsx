"use client";

import type { Dispatch } from "react";
import type { ConnectionDiff } from "./_model";
import type { Action, Selection } from "./_state";
import { fmtOhm, fmtV } from "./_view";

const TERM: Record<string, [number, number]> = {
  "R1.positive": [190, 70],
  "R1.negative": [190, 130],
  "R2.positive": [190, 170],
  "R2.negative": [190, 230],
};
const NODES: Record<string, [number, number]> = { VIN: [190, 50], VOUT: [190, 150], GND: [190, 260] };
const ZIG = (y: number) => `M190 ${y} V${y + 8} L180 ${y + 14} L200 ${y + 26} L180 ${y + 38} L200 ${y + 50} L190 ${y + 56} V${y + 60}`;

type Props = {
  selection: Selection;
  dispatch: Dispatch<Action>;
  diffs: ConnectionDiff[];
  intended: Record<string, number>;
  builtCurrents?: Record<string, number>;
  values: Record<string, number>;
};

/** Intended schematic of the 5 V divider. Fixed layout; electrical meaning comes from the graph. */
export function Schematic({ selection, dispatch, diffs, intended, builtCurrents, values }: Props) {
  const selComp = selection?.kind === "component" ? selection.id : null;
  const selNode = selection?.kind === "node" ? selection.name : null;
  const pick = (id: string) => () => dispatch({ type: "select", sel: { kind: "component", id } });
  const key = (id: string) => (e: React.KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(id)());
  const bad = new Set(diffs.map((d) => `${d.componentId}.${d.terminal}`));
  const splitNodes = new Set(diffs.map((d) => d.intendedNode));
  const cur = (id: string) => (builtCurrents && id in builtCurrents ? `${(Math.abs(builtCurrents[id]) * 1000).toFixed(3)} mA ↓` : null);
  return (
    <svg className="st-svg" viewBox="0 0 360 300" role="group" aria-label="Intended schematic: 5 volt divider" data-testid="schematic">
      <g stroke="#142c32" strokeWidth={2} fill="none">
        <path d="M70 50 H190 M70 50 V127 M70 183 V260 H190 M190 50 V70 M190 130 V170 M190 230 V260 M190 150 H300" />
        {/* ground symbol */}
        <path d="M172 268 H208 M178 274 H202 M184 280 H196" />
      </g>
      {/* V1 */}
      <g data-testid="sch-V1" role="button" tabIndex={0} aria-label="V1 5 volt supply" className="st-clickable" onClick={pick("V1")} onKeyDown={key("V1")}>
        <circle cx={70} cy={155} r={28} fill="#fff" stroke={selComp === "V1" ? "#f2b45a" : "#142c32"} strokeWidth={selComp === "V1" ? 5 : 2} />
        <text x={70} y={152} textAnchor="middle" fontSize={16} fill="#142c32">+</text>
        <text x={70} y={174} textAnchor="middle" fontSize={16} fill="#142c32">−</text>
        <text x={20} y={150} fontSize={13} fill="#142c32">V1</text>
        <text x={20} y={166} fontSize={13} fill="#53656a">5 V</text>
      </g>
      {(["R1", "R2"] as const).map((id, i) => {
        const y = i === 0 ? 70 : 170;
        const ohms = id === "R1" ? 10000 : 10000;
        return (
          <g key={id} data-testid={`sch-${id}`} role="button" tabIndex={0} aria-label={`${id} resistor ${fmtOhm(ohms)}`} className="st-clickable" onClick={pick(id)} onKeyDown={key(id)}>
            <rect x={160} y={y} width={60} height={60} fill="transparent" />
            <path d={ZIG(y)} fill="none" stroke={selComp === id ? "#f2b45a" : "#142c32"} strokeWidth={selComp === id ? 6 : 2.5} />
            <path d={ZIG(y)} fill="none" stroke="#142c32" strokeWidth={2} />
            <text x={212} y={y + 28} fontSize={13} fill="#142c32">{id} {fmtOhm(ohms)}</text>
            {cur(id) && <text x={212} y={y + 44} fontSize={11} fill="#53656a">{cur(id)} (/api/solve)</text>}
          </g>
        );
      })}
      {Object.entries(NODES).map(([name, [x, y]]) => (
        <g key={name} data-testid={`node-${name}`} role="button" tabIndex={0} aria-label={`node ${name}, intended ${fmtV(intended[name])}`} className="st-clickable" onClick={() => dispatch({ type: "select", sel: { kind: "node", name } })} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), dispatch({ type: "select", sel: { kind: "node", name } }))}>
          <circle cx={x} cy={y} r={14} fill="transparent" />
          <circle cx={x} cy={y} r={selNode === name ? 8 : 5} fill={selNode === name ? "#f2b45a" : "#142c32"} stroke="#142c32" strokeWidth={2} />
          <text x={name === "VOUT" ? 305 : x + 14} y={name === "VOUT" ? 146 : name === "GND" ? y + 22 : y - 8} fontSize={13} fontWeight={600} fill="#142c32">{name}</text>
          {name === "VOUT" ? <text x={305} y={163} fontSize={12} fill="#53656a">{fmtV(intended[name])}{values[name] !== undefined ? ` · built ${fmtV(values[name])}` : ""}</text> : <text x={name === "GND" ? x + 14 : x + 14} y={name === "GND" ? y + 36 : y + 8} fontSize={12} fill="#53656a">{fmtV(intended[name])}</text>}
        </g>
      ))}
      {Object.entries(TERM).filter(([k]) => bad.has(k)).map(([k, [x, y]]) => (
        <circle key={k} className="st-ring st-pulse" cx={x} cy={y} r={9} data-testid={`fault-${k}`} />
      ))}
      {[...splitNodes].map((n) => (
        <text key={n} x={355} y={182} textAnchor="end" fontSize={12} fontWeight={700} fill="#943e2c">{n} split in build</text>
      ))}
    </svg>
  );
}
