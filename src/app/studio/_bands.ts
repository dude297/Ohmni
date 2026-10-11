// Resistor colour code (4-band, 5% gold tolerance). Pure.
export const BAND_HEX = ['#111111', '#7a3f1a', '#c0392b', '#e67e22', '#f1c40f', '#2e8b57', '#2f6db5', '#7d3c98', '#808080', '#f4f4f4'];
export const BAND_NAME = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
export const GOLD = '#c9a227';
export const SILVER = '#b8b8b8';

/** Returns 4 band colours [d1, d2, multiplier, tolerance] or null for unsupported values. */
export function resistorBands(ohms: number): { hex: string[]; names: string[] } | null {
  if (!(ohms >= 1) || !Number.isFinite(ohms) || ohms >= 1e11) return null;
  let exp = Math.floor(Math.log10(ohms)) - 1; // two significant digits
  let sig = Math.round(ohms / 10 ** exp);
  if (sig >= 100) {
    sig = Math.round(sig / 10);
    exp += 1;
  }
  const d1 = Math.floor(sig / 10);
  const d2 = sig % 10;
  const mult = exp === -1 ? { hex: GOLD, name: 'gold' } : exp >= 0 && exp <= 9 ? { hex: BAND_HEX[exp], name: BAND_NAME[exp] } : null;
  if (!mult || d1 < 1) return null;
  return { hex: [BAND_HEX[d1], BAND_HEX[d2], mult.hex, GOLD], names: [BAND_NAME[d1], BAND_NAME[d2], mult.name, 'gold'] };
}
