// Deterministic RFC-4180-ish CSV reader for instrument exports. Pure, offline, no deps.
// Supports: quoted fields with "" escapes, CRLF/LF/CR line ends, a leading UTF-8 BOM,
// blank lines, and comment lines whose first character is '#'. A header row is required.

export const REQUIRED_COLUMNS = ['node', 'value', 'unit'] as const;
export const OPTIONAL_COLUMNS = ['timestamp', 'instrument', 'channel', 'note'] as const;
export type Column = (typeof REQUIRED_COLUMNS)[number] | (typeof OPTIONAL_COLUMNS)[number];

export type CsvRecord = { line: number; fields: string[]; raw: string };
export type CsvRow = { row: number; values: Partial<Record<Column, string>>; raw: string };
export type CsvTable = { rows: CsvRow[]; warnings: string[]; error?: string };

/** Split text into records. `line` is the 1-based physical line where the record starts. */
export function parseRecords(text: string): { records: CsvRecord[]; error?: string } {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let i = 0;
  let line = 1;
  while (i < s.length) {
    const start = i;
    const startLine = line;
    // Comment or blank line: only recognised at the start of a record.
    if (s[i] === '#' || s[i] === '\n' || s[i] === '\r') {
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
      if (s[i] === '\r' && s[i + 1] === '\n') i++;
      i++;
      line++;
      continue;
    }
    const fields: string[] = [];
    let field = '';
    let quoted = false;
    for (;;) {
      if (i >= s.length) {
        if (quoted) return { records, error: `line ${startLine}: unterminated quoted field` };
        fields.push(field);
        break;
      }
      const ch = s[i++];
      if (quoted) {
        if (ch !== '"') {
          if (ch === '\n' || (ch === '\r' && s[i] !== '\n')) line++;
          field += ch;
        } else if (s[i] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else if (ch === '"' && field === '') quoted = true;
      else if (ch === ',') {
        fields.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        fields.push(field);
        if (ch === '\r' && s[i] === '\n') i++;
        line++;
        break;
      } else field += ch;
    }
    records.push({ line: startLine, fields, raw: s.slice(start, i).replace(/\r?\n$|\r$/, '') });
  }
  return { records };
}

/** Parse CSV text into rows keyed by documented column names (header required, case-insensitive). */
export function parseCsv(text: string): CsvTable {
  const { records, error } = parseRecords(text);
  if (error) return { rows: [], warnings: [], error };
  const [header, ...data] = records;
  if (!header) return { rows: [], warnings: [], error: 'no header row (expected columns: node,value,unit)' };
  const names = header.fields.map((f) => f.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length)
    return { rows: [], warnings: [], error: `line ${header.line}: header missing required column(s): ${missing.join(', ')}` };
  const known = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);
  const warnings: string[] = [];
  const extra = names.filter((n) => !known.has(n));
  if (extra.length) warnings.push(`ignored unknown column(s): ${extra.join(', ')}`);
  const dup = names.filter((n, k) => known.has(n) && names.indexOf(n) !== k);
  if (dup.length) return { rows: [], warnings, error: `line ${header.line}: duplicate column(s): ${dup.join(', ')}` };

  const rows = data.map((r) => {
    const values: CsvRow['values'] = {};
    names.forEach((n, k) => {
      if (known.has(n) && k < r.fields.length) values[n as Column] = r.fields[k].trim();
    });
    return { row: r.line, values, raw: r.raw };
  });
  return { rows, warnings };
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * Parse a reading to volts. Units: `V` or `mV` (case-insensitive, trimmed), except `MV`
 * (reads as megavolts) which is rejected as ambiguous. mV→V is exact: the decimal exponent is
 * shifted before parsing, so "450" mV and "0.45" V give the identical double.
 */
export function parseVolts(value: string, unit: string): { volts: number } | { error: string } {
  const v = value.trim();
  if (!NUMBER.test(v)) return { error: `malformed value "${value}" (plain decimal only; no commas, NaN or Infinity)` };
  const u = unit.trim();
  let shift: number;
  if (u.toLowerCase() === 'v') shift = 0;
  else if (u === 'MV') return { error: 'ambiguous unit "MV" (megavolts?); use V or mV' };
  else if (u.toLowerCase() === 'mv') shift = -3;
  else return { error: `unsupported unit "${unit}" (only V or mV)` };
  const [mantissa, exp = '0'] = v.split(/e/i);
  const volts = Number(`${mantissa}e${Number(exp) + shift}`);
  return Number.isFinite(volts) ? { volts: volts === 0 ? 0 : volts } : { error: `value "${value}" out of range` };
}
