// Tenant-isolation check: pending migrations + supabase/tests/rls_matrix.sql in ONE transaction that rolls back.
// Proves a schema change keeps RLS intact before it is applied; leaves the database unchanged.
// Usage (linked project, `supabase link --project-ref <ref>` first): node scripts/rls-check.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Every query goes through a file: on Windows the CLI is a .cmd shim run via a shell, which would split SQL arguments.
const sb = (args) => execFileSync('supabase', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const rows = (out) => JSON.parse(out.slice(out.indexOf('{'))).rows;
const tmp = mkdtempSync(join(tmpdir(), 'rls-'));
const query = (sql, name) => {
  const file = join(tmp, name);
  writeFileSync(file, sql);
  return rows(sb(['db', 'query', '--linked', '-f', file]));
};

const applied = new Set(query('select version from supabase_migrations.schema_migrations', 'applied.sql').map((r) => r.version));
const dir = 'supabase/migrations';
const pending = readdirSync(dir).filter((f) => f.endsWith('.sql') && !applied.has(f.split('_')[0])).sort();
const matrix = readFileSync('supabase/tests/rls_matrix.sql', 'utf8').replace(/^begin;$/m, '').replace(/^rollback;$/m, '');
const sql = ['begin;', ...pending.map((f) => `-- ${f}\n${readFileSync(join(dir, f), 'utf8')}`), matrix, 'rollback;'].join('\n');

console.log(`pending migrations: ${pending.length ? pending.join(', ') : 'none'}`);
try {
  const result = query(sql, 'check.sql');
  const ok = result?.[0]?.result === 'RLS MATRIX: ALL PASS';
  console.log(ok ? 'RLS MATRIX: ALL PASS (rolled back)' : `unexpected result: ${JSON.stringify(result)}`);
  process.exitCode = ok ? 0 : 1;
} catch (e) {
  const msg = String(e.stderr || e.message);
  console.error((msg.match(/FAIL[^\\"]*/) ?? [msg.slice(0, 800)])[0]);
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
