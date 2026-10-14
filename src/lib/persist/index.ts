import { z } from 'zod';
import type { CircuitGraph } from '../circuit/types';
import { validateGraph } from '../circuit/validate';
import { revisionId } from '../circuit/revision';
import { probeStep, type Observation, type ProbeStep } from '../probe';
import { RepairError, repairStep, VerifyInputError, verifyHypothesis } from '../repair';
import { adminDb, ApiError, dbFail, engineVersion, type Caller } from '../server/supabase';

// Persistence for Project -> Design Revision -> Investigation -> Measurement -> Hypothesis -> Repair Proposal -> Verification.
// User-authored rows go through the caller's RLS-scoped client. Engine output (hypotheses, proposals, verifications) is
// recomputed here from STORED evidence and written with the service role, only after the caller's access was proven.

const name = z.string().trim().min(1).max(120);
export const schemas = {
  workspace: z.object({ name }),
  project: z.object({ workspaceId: z.uuid(), name: z.string().trim().min(1).max(200), description: z.string().max(4000).optional() }),
  revision: z.object({
    graph: z.unknown(),
    source: z.enum(['image_extraction', 'netlist_import', 'manual', 'fixture']),
    parentId: z.uuid().optional(),
    sourceArtifactId: z.uuid().optional(), // saved schematic image this circuit was read from (same workspace, FK-enforced)
  }),
  investigation: z.object({ revisionId: z.uuid(), title: z.string().trim().min(1).max(200) }),
  close: z.object({ status: z.enum(['resolved', 'abandoned']) }),
  measurement: z.object({
    node: z.string().min(1).max(32),
    volts: z.number().finite().refine((v) => Math.abs(v) < 1e6, 'out of range'),
    method: z.enum(['typed', 'voice', 'csv', 'instrument']),
    instrument: z.string().max(120).optional(),
    supersedes: z.uuid().optional(),
    provenance: z.record(z.string(), z.unknown()).optional(),
  }),
  verify: z.object({
    volts: z.number().finite().refine((v) => Math.abs(v) < 1e6, 'out of range'),
    method: z.enum(['typed', 'voice', 'csv', 'instrument']),
    instrument: z.string().max(120).optional(),
  }),
};

const nodesOf = (g: CircuitGraph) => [...new Set(g.components.flatMap((c) => [c.positiveNode, c.negativeNode]))];

async function one<R extends { data: unknown; error: { code?: string } | null }>(q: PromiseLike<R>, what: string): Promise<NonNullable<R['data']>> {
  const { data, error } = await q;
  if (error) dbFail(error, what);
  if (!data) throw new ApiError(404, 'NOT_FOUND', `${what}: not found.`);
  return data as NonNullable<R['data']>;
}

async function requireEditor({ user, db }: Caller, workspaceId: string) {
  const { data, error } = await db.from('workspace_members').select('role').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
  if (error) dbFail(error, 'check membership');
  if (!data || data.role === 'viewer') throw new ApiError(403, 'FORBIDDEN', 'Editor access to this workspace is required.');
}

// ---- workspaces / projects / revisions -------------------------------------------------------------------------

export async function createWorkspace(c: Caller, b: z.infer<typeof schemas.workspace>) {
  return one(c.db.from('workspaces').insert({ name: b.name, created_by: c.user.id }).select('id, name, created_at').single(), 'create workspace');
}

export async function listWorkspaces(c: Caller) {
  const { data, error } = await c.db.from('workspace_members').select('role, workspace:workspaces (id, name, created_at)').eq('user_id', c.user.id);
  if (error) dbFail(error, 'list workspaces');
  return data ?? [];
}

export async function createProject(c: Caller, b: z.infer<typeof schemas.project>) {
  return one(
    c.db.from('projects').insert({ workspace_id: b.workspaceId, name: b.name, description: b.description, created_by: c.user.id }).select('id, workspace_id, name, description, created_at').single(),
    'create project',
  );
}

export async function listProjects(c: Caller, workspaceId: string) {
  const { data, error } = await c.db.from('projects').select('id, workspace_id, name, description, created_at, archived_at').eq('workspace_id', workspaceId).order('created_at');
  if (error) dbFail(error, 'list projects');
  return data ?? [];
}

/** Confirming a circuit = storing an immutable revision with confirmed_by = the caller. Same graph twice returns the existing one. */
export async function confirmRevision(c: Caller, projectId: string, b: z.infer<typeof schemas.revision>) {
  const v = validateGraph(b.graph);
  if (!v.ok) throw new ApiError(422, 'INVALID_GRAPH', 'Circuit graph is invalid', v.errors);
  const project = await one(c.db.from('projects').select('id, workspace_id').eq('id', projectId).maybeSingle(), 'project');
  const revision_hash = revisionId(v.graph);
  const cols = 'id, project_id, parent_id, source_artifact_id, revision_hash, source, graph, confirmed_by, confirmed_at';
  const { data, error } = await c.db
    .from('design_revisions')
    .insert({ workspace_id: project.workspace_id, project_id: projectId, parent_id: b.parentId, source_artifact_id: b.sourceArtifactId, revision_hash, source: b.source, graph: v.graph, confirmed_by: c.user.id })
    .select(cols)
    .single();
  if (error?.code === '23505')
    return { revision: await one(c.db.from('design_revisions').select(cols).eq('project_id', projectId).eq('revision_hash', revision_hash).maybeSingle(), 'revision'), existing: true };
  if (error || !data) dbFail(error, 'confirm revision');
  return { revision: data, existing: false };
}

export async function listRevisions(c: Caller, projectId: string) {
  const { data, error } = await c.db.from('design_revisions').select('id, parent_id, revision_hash, source, confirmed_by, confirmed_at').eq('project_id', projectId).order('confirmed_at');
  if (error) dbFail(error, 'list revisions');
  return data ?? [];
}

// ---- investigations ----------------------------------------------------------------------------------------------

export async function openInvestigation(c: Caller, b: z.infer<typeof schemas.investigation>) {
  const rev = await one(c.db.from('design_revisions').select('id, workspace_id, project_id').eq('id', b.revisionId).maybeSingle(), 'revision');
  return one(
    c.db
      .from('investigations')
      .insert({ workspace_id: rev.workspace_id, project_id: rev.project_id, revision_id: rev.id, title: b.title, opened_by: c.user.id })
      .select('id, workspace_id, project_id, revision_id, title, status, opened_at')
      .single(),
    'open investigation',
  );
}

type Loaded = {
  inv: { id: string; workspace_id: string; project_id: string; revision_id: string; title: string; status: string; opened_at: string; closed_at: string | null };
  graph: CircuitGraph;
  revisionHash: string;
  measurements: { id: string; node: string; value: number; method: string; measured_at: string; supersedes: string | null; provenance: Record<string, unknown> }[];
};

async function load(c: Caller, id: string): Promise<Loaded> {
  const inv = await one(
    c.db.from('investigations').select('id, workspace_id, project_id, revision_id, title, status, opened_at, closed_at, revision:design_revisions (graph, revision_hash)').eq('id', id).maybeSingle(),
    'investigation',
  );
  const { revision, ...rest } = inv as unknown as Loaded['inv'] & { revision: { graph: CircuitGraph; revision_hash: string } };
  const { data: measurements, error } = await c.db
    .from('measurements')
    .select('id, node, value, method, measured_at, supersedes, provenance')
    .eq('investigation_id', id)
    .order('measured_at')
    .order('id');
  if (error) dbFail(error, 'load measurements');
  return { inv: rest, graph: revision.graph, revisionHash: revision.revision_hash, measurements: measurements ?? [] };
}

/** Diagnosis evidence: powered voltage readings that are not superseded and not post-repair verification readings. */
function evidence(l: Loaded) {
  const superseded = new Set(l.measurements.map((m) => m.supersedes).filter(Boolean));
  const used = l.measurements.filter((m) => !superseded.has(m.id) && m.provenance?.kind !== 'verification');
  return { ids: used.map((m) => m.id), obs: used.map((m): Observation => ({ node: m.node, volts: m.value })) };
}

async function snapshot(l: Loaded, step: ProbeStep, ids: string[]) {
  const rows = step.hypotheses
    .filter((h, i) => i < 12 || h.probability >= 0.01) // ponytail: top hypotheses only; the full posterior is recomputable from stored evidence
    .map((h) => ({
      workspace_id: l.inv.workspace_id,
      investigation_id: l.inv.id,
      revision_id: l.inv.revision_id,
      engine: 'probe',
      engine_version: engineVersion(),
      hypothesis_key: h.id,
      probability: Math.min(1, Math.max(0, h.probability)),
      fit: step.fit ?? 'good',
      evidence_measurement_ids: ids,
    }));
  const { data, error } = await adminDb().from('hypotheses').insert(rows).select('id, hypothesis_key');
  if (error) dbFail(error, 'store hypotheses');
  return new Map((data ?? []).map((r) => [r.hypothesis_key as string, r.id as string]));
}

export async function getInvestigation(c: Caller, id: string) {
  const l = await load(c, id);
  const [hyp, props] = await Promise.all([
    c.db.from('hypotheses').select('id, hypothesis_key, probability, fit, engine_version, evidence_measurement_ids, computed_at').eq('investigation_id', id).order('computed_at', { ascending: false }).order('probability', { ascending: false }).limit(50),
    c.db.from('repair_proposals').select('id, hypothesis_id, patch, verification_node, expect_value, tolerance, status, created_at').eq('investigation_id', id).order('created_at'),
  ]);
  for (const r of [hyp, props]) if (r.error) dbFail(r.error, 'load investigation');
  const vers = props.data?.length
    ? await c.db.from('verifications').select('id, repair_proposal_id, measurement_id, verified, delta, engine_version, created_at').in('repair_proposal_id', props.data.map((p) => p.id)).order('created_at')
    : { data: [], error: null };
  if (vers.error) dbFail(vers.error, 'load verifications');
  const latest = hyp.data?.[0]?.computed_at;
  const { obs } = evidence(l);
  return {
    investigation: l.inv,
    revision: { id: l.inv.revision_id, revisionHash: l.revisionHash, graph: l.graph },
    measurements: l.measurements,
    latestHypotheses: (hyp.data ?? []).filter((h) => h.computed_at === latest),
    probe: probeStep(l.graph, obs), // always recomputed from stored evidence, never trusted from the snapshot
    proposals: props.data ?? [],
    verifications: vers.data ?? [],
  };
}

export async function closeInvestigation(c: Caller, id: string, b: z.infer<typeof schemas.close>) {
  return one(
    c.db.from('investigations').update({ status: b.status, closed_at: new Date().toISOString() }).eq('id', id).eq('status', 'open').select('id, status, closed_at').maybeSingle(),
    'open investigation',
  );
}

// ---- evidence -> engine ------------------------------------------------------------------------------------------

export async function addMeasurement(c: Caller, id: string, b: z.infer<typeof schemas.measurement>) {
  const l = await load(c, id);
  if (l.inv.status !== 'open') throw new ApiError(409, 'INVESTIGATION_CLOSED', 'This investigation is closed.');
  if (!nodesOf(l.graph).includes(b.node) || b.node === l.graph.groundNode)
    throw new ApiError(422, 'UNKNOWN_NODE', `Node "${b.node}" is not a measurable node of this circuit.`);
  if (b.provenance && 'kind' in b.provenance) throw new ApiError(422, 'INVALID_REQUEST', 'provenance.kind is reserved.');
  const m = await one(
    c.db
      .from('measurements')
      .insert({
        workspace_id: l.inv.workspace_id,
        investigation_id: id,
        revision_id: l.inv.revision_id,
        node: b.node,
        value: b.volts,
        unit: 'V',
        method: b.method,
        instrument: b.instrument,
        supersedes: b.supersedes,
        provenance: b.provenance ?? {},
        entered_by: c.user.id,
      })
      .select('id, node, value, method, measured_at, supersedes, provenance')
      .single(),
    'add measurement',
  );
  l.measurements.push(m);
  const { ids, obs } = evidence(l);
  const step = probeStep(l.graph, obs);
  await snapshot(l, step, ids);
  return { measurement: m, probe: step };
}

export async function proposeRepair(c: Caller, id: string) {
  const l = await load(c, id);
  await requireEditor(c, l.inv.workspace_id);
  if (l.inv.status !== 'open') throw new ApiError(409, 'INVESTIGATION_CLOSED', 'This investigation is closed.');
  const { ids, obs } = evidence(l);
  let result;
  try {
    result = repairStep(l.graph, obs);
  } catch (e) {
    if (e instanceof RepairError) throw new ApiError(422, 'UNSOLVABLE', e.message);
    throw e;
  }
  if (!result.proposals.length) return { ...result, stored: [] };
  const keyToId = await snapshot(l, probeStep(l.graph, obs), ids);
  const rows = result.proposals
    .filter((p) => keyToId.has(p.hypothesisId))
    .map((p) => ({
      workspace_id: l.inv.workspace_id,
      investigation_id: id,
      revision_id: l.inv.revision_id,
      hypothesis_id: keyToId.get(p.hypothesisId)!,
      patch: p.patch,
      predicted_before: p.before.voltages,
      predicted_after: p.after.voltages,
      verification_node: p.verification.node,
      expect_value: p.verification.expectVolts,
      tolerance: p.verification.toleranceVolts,
    }));
  const { data, error } = await adminDb().from('repair_proposals').insert(rows).select('id, hypothesis_id, verification_node, expect_value, tolerance, status');
  if (error) dbFail(error, 'store repair proposals');
  return { ...result, stored: data ?? [] };
}

/** Post-repair reading: stored as evidence (provenance kind 'verification'), verdict recomputed server-side from the stored revision. */
export async function verifyProposal(c: Caller, proposalId: string, b: z.infer<typeof schemas.verify>) {
  const p = await one(
    c.db.from('repair_proposals').select('id, investigation_id, workspace_id, verification_node, hypothesis:hypotheses (hypothesis_key)').eq('id', proposalId).maybeSingle(),
    'repair proposal',
  );
  const hypothesisKey = (p as unknown as { hypothesis: { hypothesis_key: string } }).hypothesis.hypothesis_key;
  const l = await load(c, p.investigation_id);
  await requireEditor(c, l.inv.workspace_id);
  let v;
  try {
    v = verifyHypothesis(l.graph, hypothesisKey, { node: p.verification_node, volts: b.volts });
  } catch (e) {
    if (e instanceof VerifyInputError) throw new ApiError(422, e.code, e.message);
    throw e;
  }
  const m = await one(
    c.db
      .from('measurements')
      .insert({
        workspace_id: l.inv.workspace_id,
        investigation_id: l.inv.id,
        revision_id: l.inv.revision_id,
        node: p.verification_node,
        value: b.volts,
        unit: 'V',
        method: b.method,
        instrument: b.instrument,
        provenance: { kind: 'verification', proposalId },
        entered_by: c.user.id,
      })
      .select('id')
      .single(),
    'add verification reading',
  );
  const admin = adminDb();
  const ver = await one(
    admin
      .from('verifications')
      .insert({ workspace_id: l.inv.workspace_id, repair_proposal_id: proposalId, measurement_id: m.id, revision_id: l.inv.revision_id, verified: v.verified, delta: v.delta, engine_version: engineVersion() })
      .select('id, verified, delta, created_at')
      .single(),
    'store verification',
  );
  const { error } = await admin.from('repair_proposals').update({ status: v.verified ? 'verified' : 'not_verified' }).eq('id', proposalId);
  if (error) dbFail(error, 'update proposal status');
  return { verification: ver, result: { ...v, revisionId: l.revisionHash }, measurementId: m.id };
}
