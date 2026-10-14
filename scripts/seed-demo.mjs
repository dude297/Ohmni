// Seeds a known-good saved investigation for UI development and demos, through the real API (so every engine row is
// server-computed). Idempotent: --reset deletes the demo workspace first. Credentials come from env and are never printed.
// Usage: node --env-file=.env.local scripts/seed-demo.mjs [baseUrl=http://localhost:3000] [--reset]
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEMO_EMAIL, DEMO_PASSWORD (the account is created if missing).
import { createClient } from '@supabase/supabase-js';

const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const reset = process.argv.includes('--reset');
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service, DEMO_EMAIL: email, DEMO_PASSWORD: password } = process.env;
if (!url || !anon || !service || !email || !password) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DEMO_EMAIL and DEMO_PASSWORD are required');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, opts);
const WS = 'Ohmni demo bench';

const r = (id, a, b, ohms) => ({ id, kind: 'resistor', value: ohms, positiveNode: a, negativeNode: b });
const BRIDGE = {
  schemaVersion: 1,
  components: [
    { id: 'V1', kind: 'dc_voltage', value: 12, positiveNode: 'VIN', negativeNode: 'GND' },
    r('R1', 'VIN', 'A', 1000), r('R2', 'A', 'GND', 2000), r('R3', 'VIN', 'B', 1500), r('R4', 'B', 'GND', 1000),
    r('R5', 'A', 'B', 3300), r('R6', 'B', 'C', 680), r('R7', 'C', 'GND', 1200),
  ],
  groundNode: 'GND',
  measureNode: 'C',
};

const signIn = () => createClient(url, anon, opts).auth.signInWithPassword({ email, password });
let { data: s, error } = await signIn();
if (error) {
  const { error: e } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (e) throw new Error(`could not create demo user: ${e.message}`);
  ({ data: s, error } = await signIn());
  if (error) throw new Error(`demo sign-in failed: ${error.message}`);
  console.log('created demo account');
}
const token = s.session.access_token;
const call = async (method, path, body) => {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error?.code ?? ''}`);
  return json;
};

const existing = (await call('GET', '/workspaces')).workspaces.find((w) => w.workspace?.name === WS && w.role === 'owner');
if (existing && !reset) {
  console.log(`demo workspace already exists (${existing.workspace.id}); pass --reset to rebuild it`);
  process.exit(0);
}
if (existing) await call('POST', `/workspaces/${existing.workspace.id}/delete`, { confirm: WS });

const { workspace } = await call('POST', '/workspaces', { name: WS });
const { project } = await call('POST', '/projects', { workspaceId: workspace.id, name: 'Loaded bridge, 12 V', description: 'Seven-resistor bridge; C reads 0 V on the bench.' });
const { revision } = await call('POST', `/projects/${project.id}/revisions`, { graph: BRIDGE, source: 'fixture' });
const { investigation } = await call('POST', '/investigations', { revisionId: revision.id, title: 'C reads 0 V' });
let probe;
for (const [node, volts] of [['C', 0], ['A', 7.533], ['B', 5.22]]) ({ probe } = await call('POST', `/investigations/${investigation.id}/measurements`, { node, volts, method: 'typed' }));
const repair = await call('POST', `/investigations/${investigation.id}/repair`);
const top = repair.stored?.[0];
if (top) await call('POST', `/proposals/${top.id}/verify`, { volts: top.expect_value, method: 'typed' });

console.log(`seeded: workspace ${workspace.id}, investigation ${investigation.id}`);
console.log(`diagnosis: ${probe.hypotheses[0].id} (${(probe.hypotheses[0].probability * 100).toFixed(1)}%), done=${probe.done}; repair ${top ? 'verified' : 'not proposed'}`);
