"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CircuitView } from "./circuit-view";
import { sampleGraph, solveSample } from "./api";

export function HeroCircuit() {
  const [selected, setSelected] = useState("R2");
  const [lowResistance, setLowResistance] = useState(false);
  const graph = sampleGraph();
  if (lowResistance) graph.components[2].value = 1000;
  const result = solveSample(graph);
  return (
    <div className="hero-instrument">
      <div className="instrument-top">
        <span>
          <span className="tiny-dot" /> THE CIRCUIT, EXPLAINED
        </span>
        <span className="sample-tag">INTERACTIVE SAMPLE</span>
      </div>
      <CircuitView
        graph={graph}
        selected={selected}
        onSelect={setSelected}
        result={result}
      />
      <div className="instrument-controls">
        <div>
          <span className="eyebrow">PREDICTED VOUT</span>
          <strong key={String(lowResistance)}>
            {result.voltages.VOUT.toFixed(2)}
            <small> V</small>
          </strong>
        </div>
        <button
          className="switch-value"
          onClick={() => {
            setLowResistance(!lowResistance);
            setSelected("R2");
          }}
        >
          Set R2 to {lowResistance ? "10 kΩ" : "1 kΩ"}
          <ArrowUpRight size={16} />
        </button>
      </div>
      <div className="instrument-note">
        {lowResistance
          ? "One component changes the whole story."
          : "Equal resistors. Half the supply voltage."}{" "}
        <Link href="/lab?sample=divider">Inspect circuit →</Link>
      </div>
    </div>
  );
}
