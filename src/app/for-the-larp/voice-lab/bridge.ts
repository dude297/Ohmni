import type { CircuitGraph } from "../../../lib/circuit/types";

// Loaded bridge, 12 V. Defined locally (Voice Lab owns only this folder); identical topology to the /probe fixture on main.
const r = (id: string, a: string, b: string, value: number) => ({ id, kind: "resistor" as const, value, positiveNode: a, negativeNode: b });
export const LOADED_BRIDGE: CircuitGraph = {
  schemaVersion: 1,
  components: [
    { id: "V1", kind: "dc_voltage", value: 12, positiveNode: "VIN", negativeNode: "GND" },
    r("R1", "VIN", "A", 1000),
    r("R2", "A", "GND", 2000),
    r("R3", "VIN", "B", 1500),
    r("R4", "B", "GND", 1000),
    r("R5", "A", "B", 3300),
    r("R6", "B", "C", 680),
    r("R7", "C", "GND", 1200),
  ],
  groundNode: "GND",
  measureNode: "C",
};

export const fmtOhmShort = (v: number) => (v >= 1000 ? `${+(v / 1000).toPrecision(3)}k` : `${v}`);
