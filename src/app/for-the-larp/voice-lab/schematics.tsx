import { schematicLayout } from "../../probe/helpers";
import type { CircuitGraph } from "../../../lib/circuit/types";
import { fmtNum } from "./parser";
import { LOADED_BRIDGE, fmtOhmShort } from "./bridge";

export type SchemProps = {
  graph: CircuitGraph;
  highlight: string | null; // node to probe next (copper)
  heard: string | null; // node of the pending reading
  readings: Record<string, number>; // MEASURED
  faultId?: string | null; // top hypothesis component (fault red)
  after?: Record<string, number> | null; // SIMULATED after-fix overlay
};
const v3 = (x: number) => `${fmtNum(+x.toPrecision(3))} V`;

function label(p: SchemProps) {
  return `Circuit schematic.${p.highlight ? ` Probe node ${p.highlight} next.` : ""}${p.heard ? ` Pending reading at ${p.heard}.` : ""}${p.faultId ? ` Suspect component ${p.faultId}, a hypothesis not a confirmed fault.` : ""}`;
}

function NodeMark({ name, x, y, p, tx, ty, anchor, hollow }: { name: string; x: number; y: number; p: SchemProps; tx: number; ty: number; anchor: "start" | "end"; hollow?: boolean }) {
  const on = name === p.highlight;
  const h = name === p.heard;
  const meas = p.readings[name];
  const aft = p.after?.[name];
  return (
    <g data-node={name} data-highlight={on || undefined} data-heard={h || undefined}>
      {on && <circle className="vl-ring" cx={x} cy={y} r={15} />}
      {h && <circle className="vl-heardRing" cx={x} cy={y} r={13} />}
      <circle className={`${on ? "vl-dot vl-dotOn" : "vl-dot"}${hollow && !on ? " vl-dotHollow" : ""}`} cx={x} cy={y} r={on ? 7 : 6} />
      <text className="vl-nlabel" x={tx} y={ty} textAnchor={anchor}>{name}</text>
      {meas !== undefined && <text className="vl-nread" x={tx} y={ty + 24} textAnchor={anchor}>{v3(meas)}</text>}
      {aft !== undefined && <text className="vl-nafter" x={tx} y={ty + (meas !== undefined ? 37 : 24)} textAnchor={anchor}>{`fix: ${v3(aft)}`}</text>}
      {on && <text className="vl-ncall" x={tx} y={ty - 14} textAnchor={anchor}>probe here</text>}
    </g>
  );
}

// Dedicated electrically-readable layout for the loaded bridge: VIN rail top, GND rail bottom,
// A and B columns, R5 horizontal between them, R6 to C, R7 down. Solid dots = real junctions.
function BridgeSchematic(p: SchemProps) {
  const val = (id: string) => fmtOhmShort(LOADED_BRIDGE.components.find((c) => c.id === id)!.value);
  const fault = (id: string) => p.faultId === id;
  const vert = (id: string, x: number, y1: number, y2: number) => {
    const m = (y1 + y2) / 2;
    return (
      <g className="vl-part" data-comp={id} data-fault={fault(id) || undefined}>
        <path d={`M${x} ${y1}V${m - 19}M${x} ${m + 19}V${y2}`} />
        <rect x={x - 8} y={m - 19} width={16} height={38} rx={2} />
        <text x={x + 14} y={m + 4}>{id} {val(id)}</text>
      </g>
    );
  };
  const horiz = (id: string, x1: number, x2: number, y: number) => {
    const m = (x1 + x2) / 2;
    return (
      <g className="vl-part" data-comp={id} data-fault={fault(id) || undefined}>
        <path d={`M${x1} ${y}H${m - 20}M${m + 20} ${y}H${x2}`} />
        <rect x={m - 20} y={y - 8} width={40} height={16} rx={2} />
        <text x={m} y={y - 14} textAnchor="middle">{id} {val(id)}</text>
      </g>
    );
  };
  return (
    <svg className="vl-schem vl-bridge" viewBox="0 0 440 300" role="img" aria-label={label(p)}>
      <rect className="vl-bg" x="0" y="0" width="440" height="300" rx="6" />
      <path className="vl-rail" d="M40 36H360M40 268H360" />
      <text className="vl-rlabel" x="46" y="26">VIN</text>
      <text className="vl-rlabel" x="46" y="288">GND</text>
      {/* V1 */}
      <g className="vl-part" data-comp="V1">
        <path d="M40 36V132M40 168V268" />
        <circle cx="40" cy="150" r="18" className="vl-src" />
        <text x="40" y="146" textAnchor="middle" className="vl-plus">+</text>
        <text x="40" y="162" textAnchor="middle" className="vl-plus">−</text>
        <text x="40" y="236" textAnchor="middle">V1 12 V</text>
      </g>
      {vert("R1", 120, 36, 150)}
      {vert("R2", 120, 150, 268)}
      {vert("R3", 230, 36, 150)}
      {vert("R4", 230, 150, 268)}
      {horiz("R5", 120, 230, 150)}
      {horiz("R6", 230, 330, 150)}
      {vert("R7", 330, 150, 268)}
      {/* junction dots: rail taps (real T-junctions) */}
      {[[120, 36], [230, 36], [120, 268], [230, 268], [330, 268], [40, 36], [40, 268]].map(([x, y]) => <circle key={`${x},${y}`} className="vl-junc" cx={x} cy={y} r={3.5} />)}
      <NodeMark name="A" x={120} y={150} p={p} tx={106} ty={146} anchor="end" />
      <NodeMark name="B" x={230} y={150} p={p} tx={240} ty={140} anchor="start" />
      <NodeMark name="C" x={330} y={150} p={p} tx={340} ty={140} anchor="start" hollow />
    </svg>
  );
}

function GenericSchematic(p: SchemProps) {
  const { nodes, parts, width, height } = schematicLayout(p.graph);
  return (
    <svg className="vl-schem" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label(p)}>
      {parts.map((c) => {
        const mid = (c.a.y + c.b.y) / 2;
        return (
          <g key={c.id} className="vl-part" data-comp={c.id} data-fault={p.faultId === c.id || undefined}>
            <path d={`M${c.a.x} ${c.a.y}H${c.laneX}V${c.b.y}H${c.b.x}`} fill="none" />
            <rect x={c.laneX - 9} y={mid - 14} width={18} height={28} rx={2} data-kind={c.kind} />
            <text x={c.laneX + 14} y={mid + 4}>{c.id}</text>
          </g>
        );
      })}
      {nodes.map((n) => <NodeMark key={n.name} name={n.name} x={n.x} y={n.y} p={p} tx={n.x - 14} ty={n.y + 4} anchor="end" />)}
    </svg>
  );
}

export function Schematic(p: SchemProps) {
  return p.graph === LOADED_BRIDGE ? <BridgeSchematic {...p} /> : <GenericSchematic {...p} />;
}
