import { z } from 'zod';
import { validateGraph } from '../../../../lib/circuit/validate';
import { analyzeAdc, configFromExtraction, extractFromCode, MAX_CODE_BYTES, proposeDiff } from '../../../../lib/firmware';

const config = z.object({
  mcu: z.string().max(80).optional(),
  bits: z.union([z.literal(8), z.literal(10), z.literal(12), z.literal(14), z.literal(16)]),
  vrefVolts: z.number().finite().positive(),
  vrefSource: z.enum(['vdd', 'internal', 'external']),
  dividerRatioInCode: z.number().finite().positive().optional(),
  formulaInCode: z.enum(['counts*vref/(2^bits-1)', 'counts*vref/2^bits']),
});
const body = z.object({
  graph: z.unknown(),
  userConfirmed: z.unknown(),
  adcNode: z.string().min(1),
  measuredVolts: z.number().finite(),
  reported: z.object({ volts: z.number().finite().optional(), counts: z.number().finite().optional() }),
  config: config.optional(),
  code: z.string().optional(),
});

const err = (status: number, code: string, message: string, details?: string[]) =>
  Response.json({ error: { code, message, ...(details && { details }) } }, { status });

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err(400, 'BAD_JSON', 'Request body must be valid JSON');
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success)
    return err(422, 'INVALID_REQUEST', 'Invalid request body', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const b = parsed.data;
  if (b.userConfirmed !== true) return err(422, 'NOT_CONFIRMED', 'User must confirm the circuit before firmware analysis');
  if (b.reported.volts === undefined && b.reported.counts === undefined)
    return err(422, 'INVALID_REQUEST', 'reported.volts or reported.counts is required');
  if (b.code !== undefined && new TextEncoder().encode(b.code).length > MAX_CODE_BYTES)
    return err(413, 'CODE_TOO_LARGE', `code must be at most ${MAX_CODE_BYTES} bytes`);
  const v = validateGraph(b.graph);
  if (!v.ok) return err(422, 'INVALID_GRAPH', 'Circuit graph is invalid', v.errors);

  const t0 = performance.now();
  const extracted = b.code !== undefined ? extractFromCode(b.code) : undefined;
  const cfg = b.config ?? (extracted && configFromExtraction(extracted));
  if (!cfg) return err(422, 'CONFIG_REQUIRED', 'Provide config, or code that defines a VREF constant and ADC resolution/divisor', extracted?.warnings);
  let result;
  try {
    result = analyzeAdc({ graph: v.graph, adcNode: b.adcNode, measuredVolts: b.measuredVolts, reported: b.reported, config: cfg });
  } catch (e) {
    return err(422, 'ANALYSIS_FAILED', e instanceof Error ? e.message : 'Analysis failed');
  }
  const proposedDiff = b.code !== undefined && extracted && result.confident ? proposeDiff(b.code, extracted, result.best) : undefined;
  const trace = [{ step: 'firmware-adc', provider: 'local', model: 'deterministic', durationMs: Math.round(performance.now() - t0), status: 'ok' }];
  // trace is returned both inside result (like /api/probe) and at top level (as specified)
  return Response.json({ result: { ...result, configUsed: cfg, ...(extracted && { extracted }), ...(proposedDiff && { proposedDiff }), trace }, trace });
}
