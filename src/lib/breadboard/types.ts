// Canonical breadboard connectivity contract. Pure data; no UI or solver imports.
export type HoleId = string; // main 'a1'..'j30|63'; rails 'L+1'..,'L-1'..,'R+1'..,'R-1'.. (index along the rail)
export type BoardSpec = { id: 'half' | 'full'; cols: 30 | 63; railSegments: number; railBreakAfter?: number[] };
export type Placement = {
  id: string; // refdes, e.g. 'R6'
  kind: 'resistor' | 'dc_supply';
  value: number;
  pins: { positive: HoleId; negative: HoleId };
};
export type Jumper = { id: string; a: HoleId; b: HoleId; color?: string };
export type BuildState = {
  board: BoardSpec;
  placements: Placement[];
  jumpers: Jumper[];
  groundNet?: HoleId; // a hole on the ground net, e.g. 'L-1'
  probeHoles?: Record<string, HoleId>; // node label -> hole, e.g. { C: 'f20' }
};
export type Strip = { id: string; holes: HoleId[] };
export type Net = { id: string; holes: HoleId[]; strips: string[]; label?: string };
export type Terminal = 'positive' | 'negative';
