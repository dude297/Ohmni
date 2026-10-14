import { caller, engineVersion } from '@/lib/server/supabase';
import { uuidParam, v1 } from '@/lib/server/v1';
import { getInvestigation } from '@/lib/persist';
import { buildReport, reportMarkdown } from '@/lib/persist/report';

// ?format=md (default, text/markdown download) | json ('ohmni.report.v1'). Built from stored evidence only.
export const GET = v1('/api/v1/investigations/[id]/report', async (req, p) => {
  const id = uuidParam(p.id);
  const report = buildReport(await getInvestigation(await caller(req), id), engineVersion());
  if (new URL(req.url).searchParams.get('format') === 'json') return report;
  return new Response(reportMarkdown(report), {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="ohmni-investigation-${id.slice(0, 8)}.md"` },
  });
});
