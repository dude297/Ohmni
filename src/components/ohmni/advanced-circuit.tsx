"use client";

import { useEffect, useRef } from "react";
import type { Graph, Result } from "./api";
import { formatValue } from "./api";

const parts: Record<string, { path: string; x: number; y: number; horizontal?: boolean }> = {
  V1: {path:"M85 50 V400",x:85,y:220},
  R1: {path:"M85 50 H260 V160",x:260,y:100},
  R2: {path:"M260 160 V400 H85",x:260,y:280},
  R3: {path:"M260 50 H490 V160",x:490,y:100},
  R4: {path:"M490 160 V400 H260",x:490,y:280},
  R5: {path:"M260 160 H490",x:375,y:160,horizontal:true},
  R6: {path:"M490 160 H665 V300",x:665,y:225},
  R7: {path:"M665 300 V400 H490",x:665,y:350},
};
const nodes=[{name:"VIN",x:85,y:50},{name:"A",x:260,y:160},{name:"B",x:490,y:160},{name:"C",x:665,y:300},{name:"GND",x:85,y:400}];

export function AdvancedCircuit({graph,selected,onSelect,result,highlightedNode,onMeasureNode,readings}: {
  graph:Graph;selected?:string;onSelect?:(id:string)=>void;result?:Result|null;
  highlightedNode?:string;onMeasureNode?:(node:string)=>void;readings?:Record<string,number>;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view=canvas.current, target=nodes.find(n=>n.name===highlightedNode);
    if(!view || !target || !view.clientWidth || view.scrollWidth<=view.clientWidth)return;
    // Move only the instrument's pan viewport, never the document scroll position.
    view.scrollTo({left:target.x/760*view.scrollWidth-view.clientWidth/2,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
  },[highlightedNode]);
  const chosen=graph.components.find(c=>c.id===selected);
  return <div className="advanced-instrument">
    <div ref={canvas} className="advanced-circuit" tabIndex={0} role="region" aria-label="Seven-resistor bridge schematic. Pan horizontally on small screens.">
      <svg viewBox="0 0 760 460" role="group" aria-label={`${graph.components.find(c=>c.kind==="dc_voltage")?.value} volt DC bridge: seven resistors, coupled nodes A, B and C.`}>
        {graph.components.map(c=>{const p=parts[c.id];const active=selected===c.id;
          return <g key={c.id} className={`advanced-part ${active?"is-active":""}`} data-component={c.id} data-positive-node={c.positiveNode} data-negative-node={c.negativeNode}
            {...(onSelect?{role:"button",tabIndex:0,"aria-label":`Inspect ${c.id}, ${formatValue(c.value,c.kind)}, ${c.positiveNode} to ${c.negativeNode}`,"aria-pressed":active,onClick:()=>onSelect(c.id),onKeyDown:(e:React.KeyboardEvent)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onSelect(c.id);}}}:{})}>
            <path className="advanced-wire" pathLength="1" d={p.path}/>
            <rect className="advanced-hit" x={p.x-30} y={p.y-35} width={60} height={70} rx={8}/>
            {c.kind==="dc_voltage"?<><circle className="advanced-symbol" cx={p.x} cy={p.y} r={26}/><path className="advanced-polarity" d={`M${p.x-7} ${p.y-9}H${p.x+7}M${p.x} ${p.y-16}V${p.y-2}M${p.x-7} ${p.y+10}H${p.x+7}`}/></>:<rect className="advanced-symbol" x={p.x-(p.horizontal?28:12)} y={p.y-(p.horizontal?12:28)} width={p.horizontal?56:24} height={p.horizontal?24:56} rx={3}/>}
            <text className="advanced-part-name" x={c.id==="V1"?30:p.horizontal?p.x-10:p.x+22} y={p.horizontal?p.y-24:p.y-5}>{c.id}</text>
            <text className="advanced-part-value" x={c.id==="V1"?22:p.horizontal?p.x-20:p.x+22} y={p.horizontal?p.y+38:p.y+17}>{formatValue(c.value,c.kind)}</text>
          </g>;
        })}
        {nodes.map(n=>{const active=n.name===highlightedNode;const value=result?.voltages[n.name]??readings?.[n.name];const above=n.name==="VIN"||n.name==="GND";return <g key={n.name} className={`advanced-node ${active?"is-target":""}`} data-node={n.name} data-highlighted={active?"true":undefined}
          {...(onMeasureNode?{role:"button",tabIndex:0,"aria-label":`Measure ${n.name}`,onClick:()=>onMeasureNode(n.name),onKeyDown:(e:React.KeyboardEvent)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();onMeasureNode(n.name);}}}:{})}>
          {active&&<circle key={highlightedNode} className="advanced-target" cx={n.x} cy={n.y} r={17}/>}
          <circle cx={n.x} cy={n.y} r={6}/>
          <text className="advanced-node-name" x={n.name==="C"?615:n.x+12} y={n.name==="C"?278:n.y+(above?-22:25)}>{n.name}</text>
          {value!==undefined&&<text className="advanced-reading" x={n.name==="C"?570:n.x+12} y={n.name==="C"?298:n.y+(above?-4:45)}>{value.toFixed(3)} V</text>}
        </g>;})}
        <path className="advanced-wire" d="M85 400 V425 M65 425 H105 M72 433 H98 M79 441 H91"/>
      </svg>
    </div>
    <div className="advanced-inspector" aria-live="polite"><span>ELECTRICAL GRAPH · {result?"SERVER MNA RESULT":Object.keys(readings??{}).length?"USER-ENTERED READINGS":"REVIEW BEFORE SOLVING"}</span>{chosen&&<strong>{chosen.id} · {formatValue(chosen.value,chosen.kind)} · {chosen.positiveNode} → {chosen.negativeNode}</strong>}<small>7 resistors · pan to inspect on mobile</small></div>
  </div>;
}
