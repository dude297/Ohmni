import { importKicad } from './kicad';
import { importSpice } from './spice';
import type { ImportOptions, NetlistResult } from './types';

export type { ImportOptions, NetlistFormat, NetlistResult, Rejected } from './types';
export { parseSiValue } from './values';

/** Import a SPICE or KiCad (.net) netlist into a CircuitGraph. Format is auto-detected ("(export" => KiCad). */
export function importNetlist(text: string, opts: ImportOptions = {}): NetlistResult {
  const format = opts.format ?? (/^\s*\(\s*export\b/i.test(text) ? 'kicad' : 'spice');
  return format === 'kicad' ? importKicad(text, opts) : importSpice(text, opts);
}
