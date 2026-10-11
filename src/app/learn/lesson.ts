import type { CircuitGraph } from "../../lib/circuit/types";

export const VIN = 5;
export const R1 = 10000;
export const R2_MIN = 100;
export const R2_MAX = 100000;

export const dividerGraph = (r2: number): CircuitGraph => ({
  schemaVersion: 1,
  components: [
    { id: "V1", kind: "dc_voltage", value: VIN, positiveNode: "VIN", negativeNode: "GND" },
    { id: "R1", kind: "resistor", value: R1, positiveNode: "VIN", negativeNode: "VOUT" },
    { id: "R2", kind: "resistor", value: r2, positiveNode: "VOUT", negativeNode: "GND" },
  ],
  groundNode: "GND",
  measureNode: "VOUT",
});

export const formulaVout = (r2: number, vin = VIN, r1 = R1) => (vin * r2) / (r1 + r2);

export const r2InRange = (r2: number) => Number.isFinite(r2) && r2 >= R2_MIN && r2 <= R2_MAX;

export const errorPct = (predicted: number, actual: number) =>
  actual === 0 ? Math.abs(predicted) * 100 : (Math.abs(predicted - actual) / Math.abs(actual)) * 100;

export const substitution = (r2: number) =>
  `VOUT = ${VIN} V × ${r2} Ω / (${R1} Ω + ${r2} Ω) = ${formulaVout(r2).toFixed(4)} V`;

// Hint level n (1-3) is only available once n-1 hints were opened and before reveal.
export const canShowHint = (level: number, shown: number, revealed: boolean) =>
  !revealed && level === shown + 1 && level >= 1 && level <= 3;

export const hintText = (level: 1 | 2 | 3, r2: number) =>
  level === 1
    ? "R1 and R2 share the same current. Is R2 bigger or smaller than R1? That decides whether VOUT is above or below half of VIN."
    : level === 2
      ? "VOUT is the fraction of VIN that falls across R2: VOUT = VIN × R2 / (R1 + R2)."
      : `Plug in VIN = ${VIN} V, R1 = ${R1} Ω, R2 = ${r2} Ω and compute the fraction R2 / (R1 + R2) first.`;
