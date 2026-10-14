// End-to-end check of the persistence API (/api/v1/*) against a running Ohmni and a real Supabase project.
// Creates two throwaway users, runs the loaded-bridge investigation through confirm -> measure -> diagnose -> repair
// -> verify, checks tenant isolation, then deletes everything it created.
// Usage: node --env-file=.env.local scripts/persistence-e2e.mjs [baseUrl=http://localhost:3000] [--with-model]
// --with-model adds ONE real /api/explain call (free-tier Gemini) to check usage metering (model_traces).
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. Never run against a production database.
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const withModel = process.argv.includes('--with-model');
const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service } = process.env;
if (!url || !anon || !service) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are required');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, service, opts);

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

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) failures++;
};

async function user(tag) {
  const email = `e2e-${tag}-${randomBytes(4).toString('hex')}@test.invalid`;
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const { data: s, error: e2 } = await createClient(url, anon, opts).auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, token: s.session.access_token, email };
}

const call = async (token, method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null), rid: res.headers.get('x-request-id') };
};

const users = [];
const workspaces = [];
try {
  const A = await user('a');
  const B = await user('b');
  users.push(A, B);

  const noAuth = await call(null, 'GET', '/api/v1/workspaces');
  check('no token -> 401 UNAUTHENTICATED', noAuth.status === 401 && noAuth.json?.error?.code === 'UNAUTHENTICATED' && !!noAuth.rid);
  const badAuth = await call('x'.repeat(40), 'GET', '/api/v1/workspaces');
  check('bad token -> 401', badAuth.status === 401);

  const ws = await call(A.token, 'POST', '/api/v1/workspaces', { name: 'e2e bench' });
  check('A creates workspace', ws.status === 200 && !!ws.json?.workspace?.id, `${ws.status}`);
  const wsId = ws.json.workspace.id;
  workspaces.push(wsId);
  const list = await call(A.token, 'GET', '/api/v1/workspaces');
  check('A lists workspace as owner', list.json?.workspaces?.some((w) => w.workspace?.id === wsId && w.role === 'owner'));

  const proj = await call(A.token, 'POST', '/api/v1/projects', { workspaceId: wsId, name: 'Loaded bridge' });
  check('A creates project', proj.status === 200, `${proj.status}`);
  const projectId = proj.json.project.id;

  const bad = await call(A.token, 'POST', `/api/v1/projects/${projectId}/revisions`, { graph: { ...BRIDGE, components: [] }, source: 'fixture' });
  check('invalid graph -> 422 INVALID_GRAPH', bad.status === 422 && bad.json?.error?.code === 'INVALID_GRAPH');
  const rev = await call(A.token, 'POST', `/api/v1/projects/${projectId}/revisions`, { graph: BRIDGE, source: 'fixture' });
  check('A confirms revision', rev.status === 200 && /^rev_[0-9a-f]{16}$/.test(rev.json?.revision?.revision_hash ?? '') && rev.json.revision.confirmed_by === A.id, `${rev.status}`);
  const again = await call(A.token, 'POST', `/api/v1/projects/${projectId}/revisions`, { graph: { ...BRIDGE, components: [...BRIDGE.components].reverse() }, source: 'fixture' });
  check('same circuit (reordered) -> existing revision', again.json?.existing === true && again.json?.revision?.id === rev.json.revision.id);

  const inv = await call(A.token, 'POST', '/api/v1/investigations', { revisionId: rev.json.revision.id, title: 'C reads 0 V' });
  check('A opens investigation', inv.status === 200, `${inv.status}`);
  const invId = inv.json.investigation.id;

  const unknown = await call(A.token, 'POST', `/api/v1/investigations/${invId}/measurements`, { node: 'Z9', volts: 1, method: 'typed' });
  check('unknown node -> 422', unknown.status === 422 && unknown.json?.error?.code === 'UNKNOWN_NODE');
  const m1 = await call(A.token, 'POST', `/api/v1/investigations/${invId}/measurements`, { node: 'C', volts: 0, method: 'typed' });
  check('C=0 -> next probe A', m1.status === 200 && m1.json?.probe?.next?.node === 'A', `${m1.json?.probe?.next?.node}`);
  const m2 = await call(A.token, 'POST', `/api/v1/investigations/${invId}/measurements`, { node: 'A', volts: 7.533, method: 'typed' });
  check('A=7.533 -> R6 open leads, next B', m2.json?.probe?.hypotheses?.[0]?.id === 'R6:open' && m2.json?.probe?.next?.node === 'B');
  const m3 = await call(A.token, 'POST', `/api/v1/investigations/${invId}/measurements`, { node: 'B', volts: 5.22, method: 'voice', provenance: { transcript: 'five point two two' } });
  check('B=5.22 -> done, R6 open', m3.json?.probe?.done === true && m3.json?.probe?.hypotheses?.[0]?.id === 'R6:open' && m3.json?.probe?.fit === 'good');

  const got = await call(A.token, 'GET', `/api/v1/investigations/${invId}`);
  check('reload: 3 measurements + stored snapshot + recomputed probe', got.json?.measurements?.length === 3 && got.json?.latestHypotheses?.[0]?.hypothesis_key === 'R6:open' && got.json?.probe?.done === true);

  const rep = await call(A.token, 'POST', `/api/v1/investigations/${invId}/repair`);
  const top = rep.json?.stored?.[0];
  check('repair proposal stored for R6', rep.status === 200 && !!top && rep.json?.proposals?.[0]?.hypothesisId === 'R6:open', `${rep.status}`);

  const wrong = await call(A.token, 'POST', `/api/v1/proposals/${top.id}/verify`, { volts: top.expect_value + 1, method: 'typed' });
  check('verify off-target -> not verified', wrong.status === 200 && wrong.json?.verification?.verified === false);
  const right = await call(A.token, 'POST', `/api/v1/proposals/${top.id}/verify`, { volts: top.expect_value, method: 'typed' });
  check('verify on-target -> verified (server expectation)', right.json?.verification?.verified === true && right.json?.result?.basis === 'server_recomputed');
  const after = await call(A.token, 'GET', `/api/v1/investigations/${invId}`);
  check('verification readings excluded from diagnosis', after.json?.measurements?.length === 5 && after.json?.probe?.hypotheses?.[0]?.id === 'R6:open' && after.json?.verifications?.length === 2);

  // Tenant isolation through the API.
  const bGet = await call(B.token, 'GET', `/api/v1/investigations/${invId}`);
  check('B cannot read A investigation', bGet.status === 404, `${bGet.status}`);
  const bAdd = await call(B.token, 'POST', `/api/v1/investigations/${invId}/measurements`, { node: 'C', volts: 1, method: 'typed' });
  check('B cannot add evidence to A investigation', bAdd.status === 404, `${bAdd.status}`);
  const bProj = await call(B.token, 'GET', `/api/v1/projects?workspaceId=${wsId}`);
  check('B lists no projects in A workspace', bProj.status === 200 && bProj.json?.projects?.length === 0);
  const bNew = await call(B.token, 'POST', '/api/v1/projects', { workspaceId: wsId, name: 'intrude' });
  check('B cannot create project in A workspace', bNew.status === 403, `${bNew.status}`);
  const bVer = await call(B.token, 'POST', `/api/v1/proposals/${top.id}/verify`, { volts: top.expect_value, method: 'typed' });
  check('B cannot verify A proposal', bVer.status === 404, `${bVer.status}`);
  const bRep = await call(B.token, 'POST', `/api/v1/investigations/${invId}/repair`);
  check('B cannot trigger repair on A investigation', bRep.status === 404, `${bRep.status}`);

  // Membership: viewer reads but cannot write; editor writes; only owners manage; last owner is protected.
  const members = `/api/v1/workspaces/${wsId}/members`;
  const nobody = await call(A.token, 'POST', members, { email: 'nobody-e2e@test.invalid', role: 'viewer' });
  check('add unknown email -> 404 USER_NOT_FOUND', nobody.status === 404 && nobody.json?.error?.code === 'USER_NOT_FOUND');
  const addV = await call(A.token, 'POST', members, { email: B.email, role: 'viewer' });
  check('A adds B as viewer', addV.status === 200 && addV.json?.member?.role === 'viewer', `${addV.status}`);
  const bRead = await call(B.token, 'GET', `/api/v1/investigations/${invId}`);
  check('viewer B reads the investigation', bRead.status === 200 && bRead.json?.measurements?.length === 5);
  const bWrite = await call(B.token, 'POST', `/api/v1/investigations/${invId}/measurements`, { node: 'C', volts: 0.01, method: 'typed' });
  check('viewer B cannot add evidence', bWrite.status === 403, `${bWrite.status}`);
  const bRepair = await call(B.token, 'POST', `/api/v1/investigations/${invId}/repair`);
  check('viewer B cannot trigger repair', bRepair.status === 403, `${bRepair.status}`);
  const bManage = await call(B.token, 'POST', members, { email: B.email, role: 'owner' });
  check('viewer B cannot promote self', bManage.status === 403, `${bManage.status}`);
  const list2 = await call(B.token, 'GET', members);
  check('member list shows both emails', list2.json?.members?.length === 2 && list2.json.members.some((m) => m.email === A.email && m.role === 'owner'));
  const lastOwner = await call(A.token, 'POST', members, { email: A.email, role: 'editor' });
  check('last owner cannot demote self', lastOwner.status === 409 && lastOwner.json?.error?.code === 'LAST_OWNER');
  const leaveOwner = await call(A.token, 'DELETE', `${members}/${A.id}`);
  check('last owner cannot leave', leaveOwner.status === 409);
  const promote = await call(A.token, 'POST', members, { email: B.email, role: 'editor' });
  check('A promotes B to editor', promote.json?.member?.role === 'editor');
  const bWrite2 = await call(B.token, 'POST', `/api/v1/investigations/${invId}/measurements`, { node: 'C', volts: 0.01, method: 'typed' });
  check('editor B adds evidence', bWrite2.status === 200 && bWrite2.json?.measurement?.node === 'C', `${bWrite2.status}`);
  const bRemoveA = await call(B.token, 'DELETE', `${members}/${A.id}`);
  check('editor B cannot remove the owner', bRemoveA.status === 403, `${bRemoveA.status}`);
  const leave = await call(B.token, 'DELETE', `${members}/${B.id}`);
  check('B leaves the workspace', leave.status === 200);
  const bAfter = await call(B.token, 'GET', `/api/v1/investigations/${invId}`);
  check('after leaving, B cannot read', bAfter.status === 404, `${bAfter.status}`);

  if (withModel) {
    const ex = await call(A.token, 'POST', '/api/explain', { graph: BRIDGE, userConfirmed: true, aiConsent: true, projectId });
    check('explain with projectId', ex.status === 200, `${ex.status}`);
    const usage = await call(A.token, 'GET', `/api/v1/workspaces/${wsId}/usage`);
    const g = usage.json?.models?.find((m) => m.provider === 'google');
    check('usage metered (calls, tokens, no content)', usage.status === 200 && g?.calls === 1, JSON.stringify(g));
  }
  const usageB = await call(B.token, 'GET', `/api/v1/workspaces/${wsId}/usage`);
  check('outsider cannot read usage', usageB.status === 404, `${usageB.status}`);

  const closed = await call(A.token, 'POST', `/api/v1/investigations/${invId}/close`, { status: 'resolved' });
  check('A resolves investigation', closed.json?.investigation?.status === 'resolved');
  const mdRes = await fetch(`${base}/api/v1/investigations/${invId}/report`, { headers: { authorization: `Bearer ${A.token}` } });
  const md = await mdRes.text();
  check('markdown report', mdRes.status === 200 && mdRes.headers.get('content-type')?.startsWith('text/markdown') && md.includes('Status **resolved**') && md.includes('R6'));
  const rj = await call(A.token, 'GET', `/api/v1/investigations/${invId}/report?format=json`);
  check('json report', rj.json?.schema === 'ohmni.report.v1' && rj.json?.repairs?.[0]?.checks?.length === 2 && rj.json?.measurements?.filter((x) => x.role === 'verification').length === 2);
  const bReport = await call(B.token, 'GET', `/api/v1/investigations/${invId}/report?format=json`);
  check('outsider cannot fetch report', bReport.status === 404, `${bReport.status}`);
  const late = await call(A.token, 'POST', `/api/v1/investigations/${invId}/measurements`, { node: 'C', volts: 1, method: 'typed' });
  check('closed investigation rejects evidence', late.status === 409);
} finally {
  for (const w of workspaces) {
    const { error } = await admin.from('workspaces').delete().eq('id', w);
    check(`cleanup workspace ${w}`, !error, error?.message);
  }
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    check(`cleanup user ${u.id}`, !error, error?.message);
  }
}
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
