import { DIVIDER_10K_10K } from '@/lib/circuit/fixtures';
import { HALF_BOARD, type BuildState } from './_model';

export const INTENDED = DIVIDER_10K_10K; // 5 V, R1 10k VIN-VOUT, R2 10k VOUT-GND

const base = (j2b: string): BuildState => ({
  board: HALF_BOARD,
  placements: [
    { id: 'V1', kind: 'dc_supply', value: 5, pins: { positive: 'L+2', negative: 'L-2' } },
    { id: 'R1', kind: 'resistor', value: 10000, pins: { positive: 'a5', negative: 'a10' } },
    { id: 'R2', kind: 'resistor', value: 10000, pins: { positive: 'a14', negative: 'a18' } },
  ],
  jumpers: [
    { id: 'J1', a: 'L+4', b: 'c5', color: '#c0392b' }, // VIN rail -> R1 top
    { id: 'J2', a: 'c10', b: j2b, color: '#f2b45a' }, // R1 VOUT strip -> R2 top
    { id: 'J3', a: 'c18', b: 'L-4', color: '#222222' }, // R2 bottom -> GND rail
  ],
  groundNet: 'L-1',
  probeHoles: { VOUT: 'd10' },
});

/** Deliberate mistake: J2 lands on column 15, one column off R2's pin (column 14). */
export const MISTAKE_PRESET = (): BuildState => base('c15');
export const CORRECT_PRESET = (): BuildState => base('c14');
export const PRESETS = { mistake: MISTAKE_PRESET, correct: CORRECT_PRESET };
export type PresetName = keyof typeof PRESETS;
