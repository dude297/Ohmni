import { extractWithFallback } from '@/lib/ai/vision';
import { routeExtraction } from '@/lib/ai/jev';
import { verifyTopology } from '@/lib/ai/secondary';
import { readFormData, sniffImage, bodyErrorResponse } from '@/lib/server/readBody';
import { consentMissing, CONSENT_MESSAGE } from '@/lib/server/consent';
import { validateGraph } from '@/lib/circuit/validate';
import type { CandidateExtraction, ModelTraceEvent, RouteChoice } from '@/lib/circuit/types';

const MAX = 5 * 1024 * 1024;

const err = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status });

export async function POST(req: Request) {
  let file: unknown;
  let consent = false;
  try {
    const fd = await readFormData(req);
    file = fd.get('image');
    consent = fd.get('aiConsent') === 'true';
  } catch (e) {
    return bodyErrorResponse(e);
  }
  if (consentMissing(consent)) return err(422, 'CONSENT_REQUIRED', CONSENT_MESSAGE);
  if (!(file instanceof File)) return err(400, 'MISSING_IMAGE', 'Field "image" is required');
  if (file.size > MAX) return err(413, 'TOO_LARGE', 'Image must be 5MB or smaller');

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Never trust the declared file.type: sniff magic bytes and pass the sniffed MIME downstream.
  const mime = sniffImage(bytes);
  if (!mime) return err(415, 'UNSUPPORTED_MEDIA', 'Image content must be png, jpeg or webp');
  const trace: ModelTraceEvent[] = [];
  let extraction: CandidateExtraction;

  const r = await extractWithFallback(bytes, mime);
  extraction = r.extraction;
  trace.push(...r.events);
  if (!r.ok) {
    // Every provider failed: skip Jev (nothing to route) and say so honestly in the trace.
    trace.push({ step: 'route', provider: 'jev', durationMs: 0, status: 'skipped', note: 'no extraction available', chosenRoute: 'ask_user' });
    return Response.json({ extraction, route: 'ask_user' satisfies RouteChoice, trace });
  }

  let validationErrors: string[] = [];
  if (extraction.graph) {
    const v = validateGraph(extraction.graph);
    if (!v.ok) validationErrors = v.errors;
  }
  const routed = await routeExtraction({ extraction, validationErrors });
  trace.push(routed.event);

  if (routed.route === 'verify_topology') {
    const v = await verifyTopology(bytes, mime, extraction);
    trace.push(v.event);
    if (v.extraction) extraction = v.extraction;
  }
  return Response.json({ extraction, route: routed.route, trace });
}
