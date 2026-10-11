import { BRIDGE_LAYOUT, NODE_POINT, RAIL_Y, formatValue, junctions, railTaps, reroutePath, terminalPoint, type DiffModel, type Graph } from "./model";

type Props = {
  graph: Graph;
  label: string; // accessible name
  tints?: DiffModel["valueTints"];
  reroutes?: DiffModel["reroutes"];
  voltages?: Record<string, number> | null;
  pulseNode?: string | null;
};

const nodeXY = (n: string): [number, number] | null => (n in RAIL_Y ? [110, RAIL_Y[n as keyof typeof RAIL_Y]] : NODE_POINT[n] ?? null);

export function Schematic({ graph, label, tints = {}, reroutes = [], voltages, pulseNode }: Props) {
  const leads = reroutes.map((r) => ({ ...r, d: reroutePath(r.componentId, r.terminal, r.to) })).filter((r) => r.d);
  const extra = leads.flatMap((l) => {
    const p = terminalPoint(l.componentId, l.terminal);
    return p && l.to in RAIL_Y ? [[p[0] + 36, RAIL_Y[l.to as keyof typeof RAIL_Y]] as [number, number]] : [];
  });
  const taps = railTaps(graph, extra);
  const pulse = pulseNode ? nodeXY(pulseNode) : null;
  const volts: [string, number, number][] = [["A", 158, 192], ["B", 308, 192], ["C", 428, 192]];
  return (
    <svg viewBox="0 0 560 330" role="img" aria-label={label} className="tw-svg">
      {taps.map((t) => (
        <g key={t.rail}>
          <line x1={t.x1} x2={t.x2} y1={t.y} y2={t.y} className="tw-wire" />
          {t.dots.map((x) => <circle key={x} cx={x} cy={t.y} r={4} className="tw-dot" />)}
          <text x={t.x2 + 8} y={t.y + 4} className="tw-railtxt">{t.rail}</text>
          {voltages && t.rail === "VIN" && voltages.VIN !== undefined && <text x={200} y={t.y - 10} className="tw-volt">{voltages.VIN.toFixed(2)} V</text>}
        </g>
      ))}
      {graph.components.map((c) => {
        const s = BRIDGE_LAYOUT[c.id];
        if (!s) return null;
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        const deg = (Math.atan2(s.y2 - s.y1, s.x2 - s.x1) * 180) / Math.PI;
        const tint = tints[c.id];
        const horiz = s.y1 === s.y2;
        const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
        return (
          <g key={c.id} className={tint ? "tw-part tw-fault" : "tw-part"} data-part={c.id}>
            {c.kind === "dc_voltage" ? (
              <>
                <line x1={s.x1} y1={s.y1} x2={s.x2} y2={my - 18} className="tw-wire" />
                <line x1={s.x1} y1={my + 18} x2={s.x2} y2={s.y2} className="tw-wire" />
                <circle cx={mx} cy={my} r={18} className="tw-src" />
                <text x={mx} y={my - 4} textAnchor="middle" className="tw-pm">+</text>
                <text x={mx} y={my + 13} textAnchor="middle" className="tw-pm">−</text>
              </>
            ) : (
              <g transform={`translate(${s.x1} ${s.y1}) rotate(${deg})`}>
                <line x1={0} x2={len / 2 - 22} className="tw-wire tw-lead" />
                <rect x={len / 2 - 22} y={-8} width={44} height={16} rx={2} className="tw-res" />
                <line x1={len / 2 + 22} x2={len} className="tw-wire tw-lead" />
              </g>
            )}
            <text x={horiz ? mx : mx + (c.kind === "dc_voltage" ? -26 : 16)} y={horiz ? my - 16 : my + 4} textAnchor={horiz ? "middle" : c.kind === "dc_voltage" ? "end" : "start"} className="tw-lbl">
              {c.id} {tint ? "" : formatValue(c.value, c.kind)}
            </text>
            {tint && (
              <text x={horiz ? mx : mx + 16} y={horiz ? my - 30 : my + 20} textAnchor={horiz ? "middle" : "start"} className="tw-tint">{tint}</text>
            )}
          </g>
        );
      })}
      {junctions(graph).map(([x, y]) => <circle key={`${x},${y}`} cx={x} cy={y} r={4.5} className="tw-dot" />)}
      {leads.map((l) => (
        <g key={`${l.componentId}${l.terminal}`} data-reroute={l.label}>
          <path d={l.d!} className="tw-reroute" />
          <text x={(terminalPoint(l.componentId, l.terminal)?.[0] ?? 0) + 42} y={235} className="tw-tint">{l.label}</text>
        </g>
      ))}
      {Object.entries(NODE_POINT).map(([n, [x, y]]) => (
        <text key={n} x={x - 12} y={y - 12} textAnchor="end" className="tw-node">{n}</text>
      ))}
      {voltages && volts.map(([n, x, y]) => voltages[n] !== undefined && <text key={n} x={x} y={y} className="tw-volt">{voltages[n].toFixed(2)} V</text>)}
      {pulse && (
        <g data-next-node={pulseNode}>
          <circle cx={pulse[0]} cy={pulse[1]} r={14} className="tw-pulse" />
          <circle cx={pulse[0]} cy={pulse[1]} r={6} className="tw-pulseDot" />
        </g>
      )}
    </svg>
  );
}
