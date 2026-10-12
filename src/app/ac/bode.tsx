"use client";

import { useRef, useState } from "react";

export type PlotCurve = { id: string; label: string; cls: string; freq: number[]; mag: number[]; phase: number[] };
export type PlotPoint = { freqHz: number; magDb: number };

const W = 760, PX0 = 56, PX1 = 744, MAG = { y0: 14, y1: 214 }, PH = { y0: 262, y1: 402 };
const LOG0 = 0, LOG1 = 7; // 1 Hz .. 10 MHz
const xOf = (f: number) => PX0 + ((Math.log10(Math.max(f, 1)) - LOG0) / (LOG1 - LOG0)) * (PX1 - PX0);
const fOf = (x: number) => 10 ** (LOG0 + ((x - PX0) / (PX1 - PX0)) * (LOG1 - LOG0));
const tick = (f: number) => (f >= 1e6 ? `${f / 1e6}M` : f >= 1e3 ? `${f / 1e3}k` : `${f}`);
const at = (c: PlotCurve, f: number) => {
  let k = 0;
  for (let i = 1; i < c.freq.length; i++) if (Math.abs(Math.log(c.freq[i] / f)) < Math.abs(Math.log(c.freq[k] / f))) k = i;
  return { f: c.freq[k], mag: c.mag[k], phase: c.phase[k] };
};

export function Bode({ curves, measured }: { curves: PlotCurve[]; measured: PlotPoint[] }) {
  const ref = useRef<SVGSVGElement>(null);
  const [cur, setCur] = useState<number | null>(null);

  const all = curves.flatMap((c) => c.mag).concat(measured.map((m) => m.magDb)).filter(Number.isFinite);
  const top = Math.min(40, Math.ceil((Math.max(0, ...all) + 1) / 10) * 10);
  const bot = Math.max(-100, Math.floor(Math.min(-20, ...all) / 20) * 20);
  const yM = (v: number) => MAG.y0 + ((top - Math.min(top, Math.max(bot, v))) / (top - bot)) * (MAG.y1 - MAG.y0);
  const yP = (v: number) => PH.y0 + ((180 - v) / 360) * (PH.y1 - PH.y0);
  const path = (c: PlotCurve, ys: number[], y: (v: number) => number) =>
    c.freq.map((f, i) => `${i ? "L" : "M"}${xOf(f).toFixed(1)} ${y(ys[i]).toFixed(1)}`).join("");

  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setCur(x >= PX0 && x <= PX1 ? x : null);
  };
  const f = cur === null ? null : fOf(cur);
  const decades = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7];
  const mTicks: number[] = [];
  for (let v = top; v >= bot; v -= top - bot > 80 ? 20 : 10) mTicks.push(v);

  return (
    <div className="ac-bode">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} 440`}
        role="img"
        aria-label="Bode plot: magnitude in dB and phase in degrees against frequency"
        onPointerMove={move}
        onPointerLeave={() => setCur(null)}
      >
        {[MAG, PH].map((p, i) => (
          <rect key={i} x={PX0} y={p.y0} width={PX1 - PX0} height={p.y1 - p.y0} className="ac-frame" />
        ))}
        {decades.map((d) => (
          <g key={d}>
            <line x1={xOf(d)} x2={xOf(d)} y1={MAG.y0} y2={MAG.y1} className="ac-grid" />
            <line x1={xOf(d)} x2={xOf(d)} y1={PH.y0} y2={PH.y1} className="ac-grid" />
            <text x={xOf(d)} y={PH.y1 + 16} className="ac-tick" textAnchor="middle">{tick(d)}</text>
          </g>
        ))}
        <text x={PX1} y={PH.y1 + 32} className="ac-tick" textAnchor="end">Hz</text>
        {mTicks.map((v) => (
          <g key={v}>
            <line x1={PX0} x2={PX1} y1={yM(v)} y2={yM(v)} className="ac-grid" />
            <text x={PX0 - 8} y={yM(v) + 4} className="ac-tick" textAnchor="end">{v}</text>
          </g>
        ))}
        {[-180, -90, 0, 90, 180].map((v) => (
          <g key={v}>
            <line x1={PX0} x2={PX1} y1={yP(v)} y2={yP(v)} className="ac-grid" />
            <text x={PX0 - 8} y={yP(v) + 4} className="ac-tick" textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={14} y={(MAG.y0 + MAG.y1) / 2} className="ac-tick" transform={`rotate(-90 14 ${(MAG.y0 + MAG.y1) / 2})`} textAnchor="middle">dB</text>
        <text x={14} y={(PH.y0 + PH.y1) / 2} className="ac-tick" transform={`rotate(-90 14 ${(PH.y0 + PH.y1) / 2})`} textAnchor="middle">deg</text>
        {curves.map((c) => (
          <g key={c.id} className={`ac-curve ${c.cls}`}>
            <path d={path(c, c.mag, yM)} />
            <path d={path(c, c.phase, yP)} />
          </g>
        ))}
        {measured.map((m, i) => (
          <circle key={i} cx={xOf(m.freqHz)} cy={yM(m.magDb)} r={5} className="ac-meas" />
        ))}
        {cur !== null && (
          <>
            <line x1={cur} x2={cur} y1={MAG.y0} y2={PH.y1} className="ac-cursor" />
            {curves.slice(0, 1).map((c) => {
              const p = at(c, f!);
              return <circle key={c.id} cx={xOf(p.f)} cy={yM(p.mag)} r={4} className="ac-dot" />;
            })}
          </>
        )}
      </svg>
      <div className="ac-readout" aria-live="off">
        {f === null ? (
          <span className="ac-muted">Hover the plot for a cursor readout</span>
        ) : (
          curves.map((c) => {
            const p = at(c, f);
            return (
              <span key={c.id} className={`ac-ro ${c.cls}`}>
                <i /> {c.label}: {p.f >= 1e3 ? `${(p.f / 1e3).toFixed(2)} kHz` : `${p.f.toFixed(1)} Hz`} · {p.mag.toFixed(2)} dB · {p.phase.toFixed(1)}°
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
