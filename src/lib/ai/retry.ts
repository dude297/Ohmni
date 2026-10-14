import type { ModelTraceEvent } from '../circuit/types';

// One bounded retry for transient provider failures (5xx, network error). Never for 429/quota (retrying burns
// free-tier quota) and never for timeouts: a second 20 s wait would double the worst case, and the cross-provider
// fallback in vision.ts already gives a timed-out read a second chance.
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function retryOnce<T extends { event: ModelTraceEvent; retryable?: boolean }>(once: () => Promise<T>, wait = sleep): Promise<T> {
  const started = Date.now();
  const a = await once();
  if (!a.retryable) return a;
  await wait(200 + Math.floor(Math.random() * 300)); // jittered so parallel instances don't retry in lockstep
  const b = await once();
  b.event.attempts = 2; // the trace records the retry; note keeps the final attempt's reason
  b.event.durationMs = Date.now() - started;
  return b;
}
