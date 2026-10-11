// Pure SI-value parser shared by the SPICE and KiCad importers.
// SPICE rules: case-insensitive; "m" = milli, "meg" = mega, "f" = femto (NOT farad), "mil" unsupported.
// Also accepts IEC 60062 RKM style ("4k7" = 4700, "4R7" = 4.7, "1M5" = 1.5e6) and trailing units (ohm, V, Ω...).
const MULT: Record<string, number> = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, g: 1e9, t: 1e12 };
const UNIT = /^(ohms?|v|volts?|r|Ω|ω)?$/;

function prefix(s: string): { mult: number; rest: string } | null {
  if (s.startsWith('meg')) return { mult: 1e6, rest: s.slice(3) };
  if (s.startsWith('mil')) return null; // ponytail: mil (25.4e-6) is a length unit, rejected rather than guessed
  const m = MULT[s[0]];
  return m ? { mult: m, rest: s.slice(1) } : { mult: 1, rest: s };
}

export type ParsedValue = { value: number; bareMilli: boolean };

/**
 * Parse a value. RKM forms (digit-letter-digit, IEC 60062) are case-sensitive for M: "1M5" = 1.5e6, "1m5" = 1.5e-3,
 * R = decimal point ("4R7" = 4.7), k = kilo, G = giga. Other forms use SPICE semantics ("1M" = milli, "1MEG" = mega);
 * `bareMilli` is true when a bare m/M suffix was used so callers can warn on resistors.
 */
export function parseSiValueDetailed(raw: string): ParsedValue | null {
  const t = raw.trim();
  const rkm = /^(\d+)(meg|[fpnuµmkgtr])(\d+)$/i.exec(t);
  if (rkm) {
    const l = rkm[2];
    const mult = l.toLowerCase() === 'r' ? 1 : l === 'M' ? 1e6 : prefix(l.toLowerCase())!.mult;
    return { value: Number(`${rkm[1]}.${rkm[3]}`) * mult, bareMilli: false };
  }
  const s = t.toLowerCase();
  const n = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(.*)$/.exec(s);
  if (!n) return null;
  const p = prefix(n[2]);
  if (!p || !UNIT.test(p.rest)) return null;
  const v = Number(n[1]) * p.mult;
  return Number.isFinite(v) ? { value: v, bareMilli: p.mult === 1e-3 && n[2][0] === 'm' && !n[2].startsWith('meg') } : null;
}

/** Returns the value in SI units, or null if it is not a plain number with optional suffix/unit. */
export function parseSiValue(raw: string): number | null {
  return parseSiValueDetailed(raw)?.value ?? null;
}

export const MILLI_WARNING = (raw: string) => `"${raw}" is milli-ohm in SPICE; did you mean ${raw.replace(/m/i, 'MEG')}?`;
