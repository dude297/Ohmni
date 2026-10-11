// Pure SI-value parser shared by the SPICE and KiCad importers.
// SPICE rules: case-insensitive; "m" = milli, "meg" = mega, "f" = femto (NOT farad), "mil" unsupported.
// Also accepts RKM style ("4k7" = 4700, "4R7" = 4.7) and trailing units (ohm, V, Ω...).
const MULT: Record<string, number> = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, g: 1e9, t: 1e12 };
const UNIT = /^(ohms?|v|volts?|r|Ω|ω)?$/;

function prefix(s: string): { mult: number; rest: string } | null {
  if (s.startsWith('meg')) return { mult: 1e6, rest: s.slice(3) };
  if (s.startsWith('mil')) return null; // ponytail: mil (25.4e-6) is a length unit, rejected rather than guessed
  const m = MULT[s[0]];
  return m ? { mult: m, rest: s.slice(1) } : { mult: 1, rest: s };
}

/** Returns the value in SI units, or null if it is not a plain number with optional suffix/unit. */
export function parseSiValue(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  const rkm = /^(\d+)(meg|[fpnuµmkgtr])(\d+)$/.exec(s);
  if (rkm) {
    const mult = rkm[2] === 'r' ? 1 : prefix(rkm[2])!.mult;
    return Number(`${rkm[1]}.${rkm[3]}`) * mult;
  }
  const n = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(.*)$/.exec(s);
  if (!n) return null;
  const p = prefix(n[2]);
  if (!p || !UNIT.test(p.rest)) return null;
  const v = Number(n[1]) * p.mult;
  return Number.isFinite(v) ? v : null;
}
