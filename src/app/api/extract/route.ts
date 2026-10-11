import { extractCircuit } from '../../../lib/ai/gemini';
import { routeExtraction } from '../../../lib/ai/jev';
import { verifyTopology } from '../../../lib/ai/secondary';
import { validateGraph } from '../../../lib/circuit/validate';
import type { CandidateExtraction, ModelTraceEvent, RouteChoice } from '../../../lib/circuit/types';

const MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX = 5 * 1024 * 1024;

const err = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

export async function POST(req: Request) {
  let file: unknown;
  try {
    file = (await req.formData()).get('image');
  } catch {
    return err(400, 'INVALID_FORM', 'Expected multipart/form-data with an "image" field');
  }
  if (!(file instanceof File)) return err(400, 'MISSING_IMAGE', 'Field "image" is required');
  if (!MIMES.includes(file.type)) return err(400, 'UNSUPPORTED_TYPE', 'Image must be png, jpeg or webp');
  if (file.size > MAX) return err(413, 'TOO_LARGE', 'Image must be 5MB or smaller');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const trace: ModelTraceEvent[] = [];
  let extraction: CandidateExtraction;

  try {
    const r = await extractCircuit(bytes, file.type);
    extraction = r.extraction;
    trace.push(r.event);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    trace.push({ step: 'extract', provider: 'gemini', durationMs: 0, status: 'error', note: msg });
    return Response.json({
      extraction: {
        inputKind: 'unknown',
        graph: null,
        warnings: [`Vision extraction unavailable: ${msg}`],
        unresolvedConnections: [],
        requiresHumanReview: true,
      } satisfies CandidateExtraction,
      route: 'ask_user' satisfies RouteChoice,
      trace,
    });
  }

  let validationErrors: string[] = [];
  if (extraction.graph) {
    const v = validateGraph(extraction.graph);
    if (!v.ok) validationErrors = v.errors;
  }
  const routed = await routeExtraction({ extraction, validationErrors });
  trace.push(routed.event);

  if (routed.route === 'verify_topology') {
    const v = await verifyTopology(bytes, file.type, extraction);
    trace.push(v.event);
    if (v.extraction) extraction = v.extraction;
  }
  return Response.json({ extraction, route: routed.route, trace });
}
