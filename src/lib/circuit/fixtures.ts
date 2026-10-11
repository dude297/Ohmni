import type { CircuitGraph } from './types';

const divider = (r2: number): CircuitGraph => ({
  schemaVersion: 1,
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 5, positiveNode: 'VIN', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: 10000, positiveNode: 'VIN', negativeNode: 'VOUT' },
    { id: 'R2', kind: 'resistor', value: r2, positiveNode: 'VOUT', negativeNode: 'GND' },
  ],
  groundNode: 'GND',
  measureNode: 'VOUT',
});

export const DIVIDER_10K_10K: CircuitGraph = divider(10000); // VOUT = 2.5 V
export const DIVIDER_10K_1K: CircuitGraph = divider(1000); // VOUT = 0.454545... V

// Hand-verified showcase: 12V × (200Ω || 300Ω) / (100Ω + 200Ω || 300Ω) = 72/11V.
export const SERIES_PARALLEL_12V: CircuitGraph = {
  schemaVersion: 1,
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 12, positiveNode: 'VIN', negativeNode: 'GND' },
    { id: 'R1', kind: 'resistor', value: 100, positiveNode: 'VIN', negativeNode: 'MID' },
    { id: 'R2', kind: 'resistor', value: 200, positiveNode: 'MID', negativeNode: 'GND' },
    { id: 'R3', kind: 'resistor', value: 300, positiveNode: 'MID', negativeNode: 'GND' },
  ],
  groundNode: 'GND',
  measureNode: 'MID',
};

// Malformed graphs (typed loosely on purpose).
export const MALFORMED_NO_GND = {
  ...DIVIDER_10K_10K,
  components: DIVIDER_10K_10K.components.map((c) => ({
    ...c,
    positiveNode: c.positiveNode === 'GND' ? 'G2' : c.positiveNode,
    negativeNode: c.negativeNode === 'GND' ? 'G2' : c.negativeNode,
  })),
};
export const MALFORMED_FLOATING = {
  ...DIVIDER_10K_10K,
  components: [
    ...DIVIDER_10K_10K.components,
    { id: 'R3', kind: 'resistor', value: 100, positiveNode: 'X', negativeNode: 'Y' },
  ],
};
export const MALFORMED_UNKNOWN_KIND = {
  ...DIVIDER_10K_10K,
  components: [{ id: 'C1', kind: 'capacitor', value: 1e-6, positiveNode: 'VIN', negativeNode: 'GND' }],
};
