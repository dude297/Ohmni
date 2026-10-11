"use client";

import { useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Component, Graph, Result, formatValue, isDivider } from "./api";

export function CircuitView({
  graph,
  selected,
  onSelect,
  result,
  uncertain = false,
  onMeasureNode,
  controls = false,
  highlightedNode,
}: {
  graph: Graph;
  selected?: string;
  onSelect?: (id: string) => void;
  result?: Result | null;
  uncertain?: boolean;
  onMeasureNode?: (node: string) => void;
  controls?: boolean;
  highlightedNode?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const divider = isDivider(graph);
  const nodes = [
    ...new Set(
      graph.components.flatMap((c) => [c.positiveNode, c.negativeNode]),
    ),
  ];
  const nodePoints = Object.fromEntries(
    nodes.map((n, i) => [
      n,
      {
        x: 230 + 155 * Math.cos((i * 2 * Math.PI) / nodes.length - Math.PI / 2),
        y: 190 + 135 * Math.sin((i * 2 * Math.PI) / nodes.length - Math.PI / 2),
      },
    ]),
  );
  const activeNodes = graph.components.find((c) => c.id === selected);
  const clickProps = (c: Component) =>
    onSelect
      ? {
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `Select ${c.id}, ${formatValue(c.value, c.kind)}, ${c.positiveNode} to ${c.negativeNode}`,
          "aria-pressed": selected === c.id,
          onClick: () => onSelect(c.id),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(c.id);
            }
          },
        }
      : {};
  const node = (name: string, x: number, y: number, dx = 15, dy = -13) => (
    <g
      key={name}
      {...(onMeasureNode ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": `Measure ${name}`,
        "aria-pressed": graph.measureNode === name,
        onClick: () => onMeasureNode(name),
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onMeasureNode(name); }
        },
      } : {})}
      className={
        `circuit-node ${highlightedNode === name ? "suggested-probe" : ""} ${graph.measureNode === name && controls ? "measure-target" : ""} ${activeNodes &&
        [activeNodes.positiveNode, activeNodes.negativeNode].includes(name)
          ? "selected-node"
          : ""}`
      }
    >
      {onMeasureNode && <circle className="node-hit-area" cx={x} cy={y} r="17" />}
      {controls && graph.measureNode === name && <circle className="measure-ring" cx={x} cy={y} r="11" />}
      <circle cx={x} cy={y} r="5" />
      {highlightedNode === name && <circle className="suggested-ring" cx={x} cy={y} r="15" />}
      <text x={x + dx} y={y + dy}>
        {name}
      </text>
      {result && result.voltages[name] !== undefined && (
        <text className="node-reading" x={x + dx} y={y + dy + 22}>
          {result.voltages[name].toFixed(3)} V
        </text>
      )}
    </g>
  );
  return (
    <div className={`circuit-canvas ${uncertain ? "uncertain-canvas" : ""}`}>
      {controls && <div className="graph-controls" aria-label="Graph view controls">
        <span>Probe: {graph.measureNode}</span>
        <button type="button" aria-label="Zoom out graph" disabled={zoom <= 0.75} onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}><Minus size={14} /></button>
        <output aria-label="Graph zoom">{Math.round(zoom * 100)}%</output>
        <button type="button" aria-label="Zoom in graph" disabled={zoom >= 2} onClick={() => setZoom((z) => Math.min(2, z + 0.25))}><Plus size={14} /></button>
        <button type="button" aria-label="Fit graph" onClick={() => setZoom(1)}><Maximize size={14} /></button>
      </div>}
      <svg
        viewBox={`${230 - 230 / zoom} ${195 - 195 / zoom} ${460 / zoom} ${390 / zoom}`}
        aria-label={
          divider
            ? "Voltage divider: VIN through R1 to VOUT, through R2 to ground; V1 supplies VIN relative to ground"
            : "Electrical graph showing component terminals and connected nodes"
        }
        role="group"
      >
        {divider ? (
          <>
            <path
              className="circuit-wire"
              d="M110 175 V55 H260 V90 M260 140 V195 M260 195 V240 M260 290 V345 H110 V225 M260 195 H355"
            />
            {graph.components.map((c) =>
              c.kind === "dc_voltage" ? (
                <g
                  key={c.id}
                  className={`circuit-part ${selected === c.id ? "selected-part" : ""}`}
                  {...clickProps(c)}
                >
                  <rect
                    className="hit-area"
                    x="65"
                    y="157"
                    width="90"
                    height="88"
                    rx="16"
                  />
                  <circle className="source-symbol" cx="110" cy="200" r="25" />
                  <path
                    className="symbol-mark"
                    d="M103 190 H117 M110 183 V197 M103 210 H117"
                  />
                  <text x="35" y="195">
                    {c.id}
                  </text>
                  <text className="part-value" x="30" y="218">
                    {formatValue(c.value, c.kind)}
                  </text>
                </g>
              ) : (
                <g
                  key={c.id}
                  className={`circuit-part ${selected === c.id ? "selected-part" : ""}`}
                  {...clickProps(c)}
                >
                  <rect
                    className="hit-area"
                    x="225"
                    y={c.id === "R1" ? 76 : 226}
                    width="145"
                    height="82"
                    rx="12"
                  />
                  <rect
                    className="resistor-symbol"
                    x="249"
                    y={c.id === "R1" ? 90 : 240}
                    width="22"
                    height="50"
                    rx="3"
                  />
                  <text x="295" y={c.id === "R1" ? 110 : 260}>
                    {c.id}
                  </text>
                  <text
                    className="part-value"
                    x="295"
                    y={c.id === "R1" ? 132 : 282}
                  >
                    {formatValue(c.value, c.kind)}
                  </text>
                </g>
              ),
            )}
            {node("VIN", 260, 55)}
            {node("VOUT", 260, 195, 18, -28)}
            {node("GND", 260, 345)}
            <path
              className="circuit-wire"
              d="M260 345 V360 M242 360 H278 M248 367 H272 M255 374 H265"
            />
          </>
        ) : (
          <>
            {graph.components.map((c, index) => {
              const a = nodePoints[c.positiveNode],
                b = nodePoints[c.negativeNode];
              const peers = graph.components.filter(
                (part) =>
                  [part.positiveNode, part.negativeNode].sort().join("|") ===
                  [c.positiveNode, c.negativeNode].sort().join("|"),
              );
              // Give parallel edges separate lanes without inventing electrical nodes.
              const lane =
                (peers.findIndex((part) => part.id === c.id) -
                  (peers.length - 1) / 2) *
                48;
              const direction = c.positiveNode < c.negativeNode ? 1 : -1;
              const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
              const offsetX = (-(b.y - a.y) / length) * lane * direction;
              const offsetY = ((b.x - a.x) / length) * lane * direction;
              const x = (a.x + b.x) / 2 + offsetX,
                y = (a.y + b.y) / 2 + offsetY;
              return (
                <g
                  key={c.id}
                  className={`circuit-part ${selected === c.id ? "selected-part" : ""}`}
                  {...clickProps(c)}
                >
                  <path
                    className="circuit-wire"
                    d={`M${a.x} ${a.y} Q${(a.x + b.x) / 2 + offsetX * 2} ${(a.y + b.y) / 2 + offsetY * 2} ${b.x} ${b.y}`}
                  />
                  <rect
                    className="resistor-symbol"
                    x={x - 16}
                    y={y - 14}
                    width="32"
                    height="28"
                    rx={c.kind === "dc_voltage" ? 14 : 3}
                  />
                  <text x={x + 22} y={y - 5 + (index % 2) * 8}>
                    {c.id}
                  </text>
                  <text
                    className="part-value"
                    x={x + 22}
                    y={y + 15 + (index % 2) * 8}
                  >
                    {formatValue(c.value, c.kind)}
                  </text>
                  {c.kind === "dc_voltage" && (
                    <text
                      className="polarity"
                      x={a.x + (b.x - a.x) * 0.28}
                      y={a.y + (b.y - a.y) * 0.28}
                    >
                      +
                    </text>
                  )}
                </g>
              );
            })}
            {nodes.map((n) => node(n, nodePoints[n].x, nodePoints[n].y))}
          </>
        )}
      </svg>
      <div className="canvas-caption">
        <span className="tiny-dot" />
        {uncertain
          ? "Candidate topology · needs your review"
          : controls ? "Select a component to edit · select a node to measure" : "Electrical connections · select a component"}
      </div>
    </div>
  );
}
