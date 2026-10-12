import type { AcGraph } from '../../src/lib/ac/types';

const src = { id: 'V1', kind: 'ac_source', amplitude: 1, a: 'in', b: 'GND' } as const;
const g = (components: AcGraph['components'], outputNode: string): AcGraph => ({
  schemaVersion: 2,
  components,
  groundNode: 'GND',
  outputNode,
});

export const rcLowpass = (R = 1e3, C = 1e-6) =>
  g([src, { id: 'R1', kind: 'resistor', value: R, a: 'in', b: 'out' }, { id: 'C1', kind: 'capacitor', value: C, a: 'out', b: 'GND' }], 'out');
export const crHighpass = (R = 1e3, C = 1e-6) =>
  g([src, { id: 'C1', kind: 'capacitor', value: C, a: 'in', b: 'out' }, { id: 'R1', kind: 'resistor', value: R, a: 'out', b: 'GND' }], 'out');
export const rlcBandpass = (R = 100, L = 10e-3, C = 1e-6) =>
  g(
    [
      src,
      { id: 'L1', kind: 'inductor', value: L, a: 'in', b: 'm' },
      { id: 'C1', kind: 'capacitor', value: C, a: 'm', b: 'out' },
      { id: 'R1', kind: 'resistor', value: R, a: 'out', b: 'GND' },
    ],
    'out',
  );
