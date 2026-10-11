import type { CircuitComponent } from '@/lib/circuit/types';
import { finish, type ImportOptions, type NetlistResult, type Rejected } from './types';
import { parseSiValue } from './values';

export const spiceNode = (n: string) => (n === '0' || n.toLowerCase() === 'gnd' ? 'GND' : n.toUpperCase());
const NAMES: Record<string, string> = {
  c: 'capacitor', l: 'inductor', d: 'diode', q: 'BJT', m: 'MOSFET', i: 'current source', x: 'subcircuit instance',
  j: 'JFET', k: 'coupled inductor', e: 'VCVS', f: 'CCCS', g: 'VCCS', h: 'CCVS', b: 'behavioral source', s: 'switch', w: 'switch', t: 'transmission line',
};
const ANALYSIS = /^\.(tran|ac|dc|print|plot|probe|save|options?|temp|width|meas(ure)?|four|noise|tf|ic|nodeset|control|endc)$/;
const SRC_FUNCS = /^(ac|sin|pulse|pwl|exp|sffm|am)\b/i;

export function importSpice(text: string, opts: ImportOptions = {}): NetlistResult {
  const warnings: string[] = [];
  const rejected: Rejected[] = [];
  const comps: CircuitComponent[] = [];
  const seen = new Set<string>();
  let measure = opts.measureNode ? spiceNode(opts.measureNode.trim()) : undefined;

  // 1. Logical lines: join "+" continuations, drop comments. Remember first physical line number.
  const logical: { line: number; text: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    const tag = /^[*;]\s*ohmni:measure\s+(\S+)/i.exec(t);
    if (tag) {
      if (!measure) measure = spiceNode(tag[1]);
      return;
    }
    if (!t || t[0] === '*' || t[0] === ';') return;
    const body = t.replace(/;.*$/, '').trim();
    if (!body) return;
    if (body[0] === '+' && logical.length) logical[logical.length - 1].text += ' ' + body.slice(1).trim();
    else logical.push({ line: i + 1, text: body });
  });

  const rej = (l: { line: number; text: string }, reason: string) => rejected.push({ line: l.line, text: l.text, reason });
  let first = true;
  let subckt = 0;
  let order: string[] = [];
  for (const l of logical) {
    const tok = l.text.split(/\s+/);
    const head = tok[0].toLowerCase();
    const isFirst = first;
    first = false;
    if (head === '.end') break;
    if (head === '.subckt') { subckt++; rej(l, 'subcircuit definitions are not supported'); continue; }
    if (head === '.ends') { subckt = Math.max(0, subckt - 1); rej(l, 'subcircuit definitions are not supported'); continue; }
    if (subckt) { rej(l, 'inside .subckt block (not supported)'); continue; }
    if (head === '.title' || head === '.op') continue;
    if (head[0] === '.') {
      if (ANALYSIS.test(head)) warnings.push(`line ${l.line}: ignored directive ${tok[0]} (analysis/output control, does not change topology)`);
      else rej(l, `unsupported directive ${tok[0]}`);
      continue;
    }
    const kind = head[0];
    // Classic SPICE: line 1 is the title. Treat it as an element only if it is a well-formed R/V line.
    if (isFirst && !((kind === 'r' || kind === 'v') && tok.length >= 4 && parseSiValue(tok[tok.length - 1]) !== null)) {
      if (NAMES[kind] && tok.length >= 4) warnings.push(`line ${l.line}: first line treated as the SPICE title, not an element`);
      continue;
    }
    if (kind !== 'r' && kind !== 'v') { rej(l, `unsupported element "${tok[0]}": ${NAMES[kind] ?? 'unknown element'} is not supported (only R and DC V)`); continue; }
    const id = tok[0].toUpperCase();
    if (seen.has(id)) { rej(l, `duplicate component name ${id}`); continue; }
    if (tok.length < 4) { rej(l, `${id}: expected "${id} n1 n2 value"`); continue; }
    const [n1, n2] = [spiceNode(tok[1]), spiceNode(tok[2])];
    let rest = tok.slice(3);
    if (kind === 'v') {
      if (rest.some((t) => SRC_FUNCS.test(t))) { rej(l, `${id}: AC/SIN/PULSE/PWL sources are not supported (DC only)`); continue; }
      if (/^dc$/i.test(rest[0])) rest = rest.slice(1);
    }
    if (rest.length !== 1) { rej(l, `${id}: unexpected or missing value parameters "${rest.join(' ')}"`); continue; }
    const value = parseSiValue(rest[0]);
    if (value === null) { rej(l, `${id}: cannot parse value "${rest[0]}"`); continue; }
    seen.add(id);
    comps.push({ id, kind: kind === 'r' ? 'resistor' : 'dc_voltage', value, positiveNode: n1, negativeNode: n2 });
    order.push(n1, n2);
  }
  if (subckt) rej({ line: 0, text: '.subckt' }, 'unterminated .subckt');
  order = order.filter((n) => n !== 'GND');
  return finish('spice', comps, rejected, warnings, measure, order[0]);
}
