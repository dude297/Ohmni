import type { AdcBits, AdcConfig, CodeExtraction, CodeFinding, Diagnosis } from './types';

// STATIC regex scan only. Pasted code is never executed, evaluated, compiled or imported.
export const MAX_CODE_BYTES = 8 * 1024;

const DIVISORS: Record<string, { bits: AdcBits; formula: AdcConfig['formulaInCode'] }> = {
  '255': { bits: 8, formula: 'counts*vref/(2^bits-1)' },
  '256': { bits: 8, formula: 'counts*vref/2^bits' },
  '1023': { bits: 10, formula: 'counts*vref/(2^bits-1)' },
  '1024': { bits: 10, formula: 'counts*vref/2^bits' },
  '4095': { bits: 12, formula: 'counts*vref/(2^bits-1)' },
  '4096': { bits: 12, formula: 'counts*vref/2^bits' },
  '16383': { bits: 14, formula: 'counts*vref/(2^bits-1)' },
  '16384': { bits: 14, formula: 'counts*vref/2^bits' },
  '65535': { bits: 16, formula: 'counts*vref/(2^bits-1)' },
  '65536': { bits: 16, formula: 'counts*vref/2^bits' },
};
const DIV_RE = /\/\s*(65535|65536|16383|16384|4095|4096|1023|1024|255|256)(\.\d*)?f?(?![\w.])/;
const VREF_RE = /^\s*(?:#define\s+(\w+)\s+|(?:(?:static|const|constexpr|volatile)\s+)*(?:float|double|int|var|let|auto)?\s*(\w+)\s*=\s*)(\d+\.?\d*|\.\d+)(f?)\s*;?\s*$/;
const strip = (l: string) => l.replace(/\/\/.*$/, '').replace(/(^|\s)#(?!define\b|include\b).*$/, '$1');

export function extractFromCode(code: string): CodeExtraction {
  const findings: CodeFinding[] = [];
  const warnings: string[] = [];
  const config: Partial<AdcConfig> = {};
  if (new TextEncoder().encode(code).length > MAX_CODE_BYTES) {
    return { config, findings, warnings: [`code exceeds ${MAX_CODE_BYTES} bytes; not scanned`] };
  }
  code.split(/\r?\n/).forEach((orig, i) => {
    const line = i + 1;
    const l = strip(orig);
    const add = (field: string, value: number | string, raw?: string) => findings.push({ field, value, line, text: orig.trim(), raw });
    const v = VREF_RE.exec(l);
    if (v && /ref|vcc|vdd|aref/i.test(v[1] ?? v[2])) {
      config.vrefVolts = Number(v[3]);
      add('vref', config.vrefVolts, v[3]);
    }
    const res = /analogReadResolution\s*\(\s*(\d+)\s*\)/.exec(l);
    if (res) {
      config.bits = Number(res[1]) as AdcBits;
      add('bits', config.bits, res[1]);
    }
    const ref = /analogReference\s*\(\s*(\w+)\s*\)/.exec(l);
    if (ref) {
      config.vrefSource = /EXTERNAL/.test(ref[1]) ? 'external' : /INTERNAL|1V1|2V56/.test(ref[1]) ? 'internal' : 'vdd';
      add('vrefSource', ref[1]);
      if (config.vrefSource === 'internal') warnings.push(`line ${line}: analogReference(${ref[1]}) selects an internal reference (e.g. 1.1 V on AVR); check VREF constant matches it`);
    }
    if (/read_u16\s*\(/.test(l) && config.bits === undefined) {
      config.bits = 16; // MicroPython read_u16() is always scaled to 16 bit
      add('bits', 16, 'read_u16');
    }
    const d = DIV_RE.exec(l);
    if (d) {
      const info = DIVISORS[d[1]];
      config.formulaInCode = info.formula;
      if (!/analogReadResolution|read_u16/.test(code) || config.bits === undefined || config.bits === info.bits) config.bits = info.bits;
      else warnings.push(`line ${line}: divisor ${d[1]} implies ${info.bits}-bit but resolution is ${config.bits}-bit`);
      add('divisor', d[1] + (d[2] ?? ''), d[1] + (d[2] ?? ''));
      const m = [...l.slice((d.index ?? 0) + d[0].length).matchAll(/\*\s*(\d+(?:\.\d+)?)f?(?![\w.])/g)].pop();
      if (m) {
        config.dividerRatioInCode = Number(m[1]);
        add('divider', config.dividerRatioInCode, m[1]);
      }
    }
  });
  if (config.vrefVolts === undefined) warnings.push('no VREF-like constant found');
  if (config.bits === undefined) warnings.push('no ADC resolution/divisor found');
  return { config, findings, warnings };
}

/** Build a full AdcConfig from a scan, or null if vref/bits are missing. */
export function configFromExtraction(e: CodeExtraction): AdcConfig | null {
  const c = e.config;
  if (c.vrefVolts === undefined || c.bits === undefined) return null;
  return { bits: c.bits, vrefVolts: c.vrefVolts, vrefSource: c.vrefSource ?? 'vdd', dividerRatioInCode: c.dividerRatioInCode, formulaInCode: c.formulaInCode ?? 'counts*vref/(2^bits-1)' };
}

const fmtLike = (raw: string, n: number) => (raw.includes('.') && Number.isInteger(n) ? n.toFixed(1) : String(n));

/** PROPOSED unified-diff-style patch for the best diagnosis. Never applied; returns null if nothing applies. */
export function proposeDiff(code: string, e: CodeExtraction, d: Diagnosis, file = 'firmware'): string | null {
  const c = d.change;
  if (!c) return null;
  const lines = code.split(/\r?\n/);
  const edits = new Map<number, string>();
  const swap = (f: CodeFinding, to: string) => {
    const cur = edits.get(f.line) ?? lines[f.line - 1];
    const idx = cur.lastIndexOf(f.raw!);
    if (f.raw && idx >= 0) edits.set(f.line, cur.slice(0, idx) + to + cur.slice(idx + f.raw.length));
  };
  const of = (field: string) => e.findings.filter((f) => f.field === field);
  if (c.param === 'vref') of('vref').forEach((f) => swap(f, fmtLike(f.raw!, Number(c.to))));
  else if (c.param === 'bits') {
    of('bits').forEach((f) => f.raw !== 'read_u16' && swap(f, String(c.to)));
    const sub = (f: CodeFinding) => swap(f, fmtLike(f.raw!, 2 ** Number(c.to) - (Number.isInteger(Math.log2(Number(f.raw))) ? 0 : 1)));
    of('divisor').forEach(sub);
  } else if (c.param === 'formula') {
    of('divisor').forEach((f) => swap(f, fmtLike(f.raw!, Number(f.raw) + (c.to === 'counts*vref/2^bits' ? 1 : -1))));
  } else if (c.param === 'ratio') {
    const r = of('divider');
    if (r.length) r.forEach((f) => swap(f, fmtLike(f.raw!, Number(c.to))));
    else if (Number(c.to) !== 1)
      of('divisor').forEach((f) => {
        const cur = edits.get(f.line) ?? lines[f.line - 1];
        edits.set(f.line, cur.replace(/\s*;\s*$/, ` * ${c.to};`));
      });
  }
  if (!edits.size) return null;
  const out = [`PROPOSED (not applied): ${d.title}`, `--- ${file} (original)`, `+++ ${file} (proposed)`];
  for (const [ln, after] of [...edits].sort((a, b) => a[0] - b[0])) out.push(`@@ line ${ln} @@`, `-${lines[ln - 1]}`, `+${after}`);
  return out.join('\n');
}
