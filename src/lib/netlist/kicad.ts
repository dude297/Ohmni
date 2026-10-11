import type { CircuitComponent } from '@/lib/circuit/types';
import { finish, type ImportOptions, type NetlistResult, type Rejected } from './types';
import { parseSiValue } from './values';

type List = { items: Sx[]; line: number };
type Sx = string | List;
const isList = (x: Sx | undefined): x is List => typeof x === 'object';

function parseSexp(text: string): List {
  const root: List = { items: [], line: 1 };
  const stack: List[] = [root];
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') line++;
    else if (c === '(') {
      const l: List = { items: [], line };
      stack[stack.length - 1].items.push(l);
      stack.push(l);
    } else if (c === ')') {
      if (stack.length === 1) throw new Error(`unbalanced ")" at line ${line}`);
      stack.pop();
    } else if (c === '"') {
      let s = '';
      for (i++; i < text.length && text[i] !== '"'; i++) {
        if (text[i] === '\\') i++;
        if (text[i] === '\n') line++;
        s += text[i];
      }
      stack[stack.length - 1].items.push(s);
    } else if (!/\s/.test(c)) {
      let j = i;
      while (j < text.length && !/[\s()"]/.test(text[j])) j++;
      stack[stack.length - 1].items.push(text.slice(i, j));
      i = j - 1;
    }
  }
  if (stack.length !== 1) throw new Error('unbalanced "(": file ended inside an expression');
  return root;
}
const kids = (l: List, head: string) => l.items.filter((x): x is List => isList(x) && x.items[0] === head);
const field = (l: List, head: string) => {
  const v = kids(l, head)[0]?.items[1];
  return typeof v === 'string' ? v : undefined;
};

const GROUND = /^(gnd|gnda|0)$/i;
const UNNAMED = /^(net-\(|unconnected-\(|\$?\d+$)/i;

export function importKicad(text: string, opts: ImportOptions = {}): NetlistResult {
  const warnings: string[] = [];
  const rejected: Rejected[] = [];
  const comps: CircuitComponent[] = [];
  let exp: List | undefined;
  try {
    exp = kids(parseSexp(text), 'export')[0];
  } catch (e) {
    rejected.push({ line: 0, text: '', reason: `s-expression parse error: ${(e as Error).message}` });
  }
  if (!exp) {
    if (!rejected.length) rejected.push({ line: 1, text: text.slice(0, 40), reason: 'no (export ...) form found; not a KiCad netlist' });
    return finish('kicad', [], rejected, warnings, undefined, undefined);
  }
  const rej = (l: List, ref: string, reason: string) => rejected.push({ line: l.line, text: `(comp (ref ${ref}) ...)`, reason });

  // Net names: strip leading "/", ground aliases -> GND, unnamed -> stable N1, N2... in file order.
  const nets = kids(kids(exp, 'nets')[0] ?? { items: [], line: 0 }, 'net');
  const named = new Set(nets.map((n) => field(n, 'name') ?? '').filter((n) => n && !UNNAMED.test(n)).map((n) => n.replace(/^\//, '')));
  let counter = 0;
  const pinNode = new Map<string, string>(); // "REF|pin" -> node
  const order: string[] = [];
  for (const net of nets) {
    const raw = field(net, 'name') ?? '';
    let name = raw.replace(/^\//, '');
    if (GROUND.test(name)) name = 'GND';
    else if (!name || UNNAMED.test(raw)) {
      do name = `N${++counter}`; while (named.has(name));
    }
    if (name !== 'GND') order.push(name);
    for (const nd of kids(net, 'node')) {
      const key = `${field(nd, 'ref')}|${field(nd, 'pin')}`;
      if (pinNode.has(key)) warnings.push(`pin ${key.replace('|', '.')} appears on more than one net; last one wins`);
      pinNode.set(key, name);
    }
  }

  const seen = new Set<string>();
  for (const c of kids(kids(exp, 'components')[0] ?? { items: [], line: 0 }, 'comp')) {
    const ref = field(c, 'ref') ?? '?';
    const value = (field(c, 'value') ?? '').trim();
    if (ref.startsWith('#')) { warnings.push(`line ${c.line}: skipped power/virtual symbol ${ref}`); continue; }
    if (seen.has(ref)) { rej(c, ref, `duplicate reference ${ref}`); continue; }
    seen.add(ref);
    const prefix = ref[0]?.toUpperCase();
    if (prefix !== 'R' && prefix !== 'V') { rej(c, ref, `unsupported component ${ref} (${value || 'no value'}): only R and DC V are supported`); continue; }
    const pins = [...pinNode.keys()].filter((k) => k.startsWith(`${ref}|`)).map((k) => k.slice(ref.length + 1));
    if (pins.length !== 2) { rej(c, ref, `${ref}: needs exactly 2 connected pins, found ${pins.length}`); continue; }
    let [a, b] = pins.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    let num: number | null;
    if (prefix === 'V') {
      if (/^(ac|sin|pulse|pwl|exp)\b/i.test(value)) { rej(c, ref, `${ref}: AC/SIN/PULSE sources are not supported (DC only)`); continue; }
      if (pins.sort().join() !== '1,2') { rej(c, ref, `${ref}: voltage source pins must be 1 (+) and 2 (-), found ${pins.join(',')}`); continue; }
      [a, b] = ['1', '2'];
      num = parseSiValue(value.replace(/^dc\s*/i, '').replace(/\s+/g, ''));
    } else num = parseSiValue(value.replace(/\s+/g, ''));
    if (num === null) { rej(c, ref, `${ref}: cannot parse value "${value}"`); continue; }
    comps.push({
      id: ref,
      kind: prefix === 'R' ? 'resistor' : 'dc_voltage',
      value: num,
      positiveNode: pinNode.get(`${ref}|${a}`)!,
      negativeNode: pinNode.get(`${ref}|${b}`)!,
    });
  }
  const m = opts.measureNode?.trim().replace(/^\//, '');
  return finish('kicad', comps, rejected, warnings, m && (GROUND.test(m) ? 'GND' : m), order[0]);
}
