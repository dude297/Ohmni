import type { ModelTraceEvent } from '../circuit/types';
import { requestIdFor } from '../server/observe';
import { adminDb, caller, dbFail, persistenceConfigured } from '../server/supabase';

const MAX_ROWS = 1000; // PostgREST default max_rows

// Usage metering for unit economics: when a signed-in caller passes a projectId, the model trace METADATA of the
// request (provider, model, status, latency, tokens) is stored in model_traces. Never prompts, images or model text.
// Best effort: any failure is logged by name and never changes the response.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordTraces(req: Request, projectId: unknown, route: string, events: ModelTraceEvent[]): Promise<void> {
  if (typeof projectId !== 'string' || !UUID.test(projectId) || !req.headers.get('authorization') || !persistenceConfigured()) return;
  const model = events.filter((e) => e.provider !== 'local');
  if (!model.length) return;
  try {
    const c = await caller(req);
    // RLS read proves membership of the project's workspace before the service role writes.
    const { data: project, error } = await c.db.from('projects').select('id, workspace_id').eq('id', projectId).maybeSingle();
    if (error || !project) return;
    const requestId = requestIdFor(req);
    const { error: e2 } = await adminDb()
      .from('model_traces')
      .insert(
        model.map((e) => ({
          workspace_id: project.workspace_id,
          project_id: project.id,
          request_id: requestId,
          route,
          step: e.step,
          provider: e.provider,
          model: e.model ?? e.provider,
          status: e.status,
          duration_ms: Math.max(0, Math.round(e.durationMs)),
          input_tokens: e.usage?.inputTokens ?? null,
          output_tokens: e.usage?.outputTokens ?? null,
        })),
      );
    if (e2) throw Object.assign(new Error('insert failed'), { name: 'TraceInsertError' });
  } catch (e) {
    console.error(JSON.stringify({ msg: 'trace_record_failed', route, error: e instanceof Error ? e.name : typeof e }));
  }
}

/** Per provider/model totals for a workspace over the last `days` (members only, RLS read). */
export async function usageSummary(c: Awaited<ReturnType<typeof caller>>, workspaceId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await c.db
    .from('model_traces')
    .select('provider, model, status, duration_ms, input_tokens, output_tokens')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS); // ponytail: JS aggregation over the newest 1000 calls; move to a SQL view/RPC when workspaces exceed it
  if (error) dbFail(error, 'load usage');
  const by = new Map<string, { provider: string; model: string; calls: number; errors: number; inputTokens: number; outputTokens: number; totalMs: number }>();
  for (const r of data ?? []) {
    const k = `${r.provider}|${r.model}`;
    const a = by.get(k) ?? { provider: r.provider, model: r.model, calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, totalMs: 0 };
    a.calls++;
    if (r.status === 'error') a.errors++;
    a.inputTokens += r.input_tokens ?? 0;
    a.outputTokens += r.output_tokens ?? 0;
    a.totalMs += r.duration_ms;
    by.set(k, a);
  }
  return { since, days, truncated: (data?.length ?? 0) >= MAX_ROWS, models: [...by.values()].sort((a, b) => b.calls - a.calls) };
}
