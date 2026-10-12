# Security and abuse limits

## Workload ceilings
| Limit | Value | Where |
|---|---|---|
| Components per graph | 60 | `MAX_COMPONENTS`, `src/lib/circuit/validate.ts` (graphs, twin observed graph, netlist imports) |
| id / node name | 1-32 chars, `A-Za-z0-9_+-.()/:~` | same |
| JSON body | 256 KB, streamed | `readJson`, `src/lib/server/readBody.ts` |
| Image upload | 6 MB streamed multipart + PNG/JPEG/WebP magic-byte sniff | `readFormData`, `sniffImage` |
| Two-fault probe pairs | 2000 (pre-counted, falls back to single faults) | `src/lib/probe-multi` |
| AC queue / analysis | queue 3 (429 BUSY); 20 s overall (504 TIMEOUT) | `src/lib/ac` |

60 components was chosen from timing: `/api/probe` at the cap runs in ~140 ms cold on the dev machine (limit 250 ms, `tests/server/ceilings.test.ts`); a 400-resistor graph used to block the event loop ~4 s and is now rejected at validation.

## Rate limiting (`src/proxy.ts`, `src/lib/server/rateLimit.ts`)
- Client IP: only the header the current host's edge overwrites is trusted: `x-vercel-forwarded-for` when `VERCEL` is set, `x-nf-client-connection-ip` when `NETLIFY` is set, or `TRUSTED_IP_HEADER` if configured (e.g. `x-real-ip` behind a proxy you control). Other platforms' headers are ignored, because a client can send them. Otherwise the Nth-from-last `X-Forwarded-For` hop (`TRUSTED_PROXY_HOPS`, default 1), else `unknown` (one shared bucket). The first XFF hop is client-controlled and is never used.
- Counter store is hard-capped at 10k keys (two-generation, O(1)); a flood of unique real IPs can age counters out early.
- Model routes (/api/extract, /api/explain, /api/review) also share a global per-route budget (`RATE_MODEL_GLOBAL_PER_MIN`, default 30) to protect free-tier quotas.
- Env limits are read once per process.

## Known limitation
All limits are **per server instance** (in-memory). Serverless instances count separately, so aggregate throughput scales with instance count. A shared store (Vercel KV / Upstash) is required for a true global limit; until then treat these as best-effort abuse damping, not a guarantee. Platform firewall rules (Vercel) are the backstop.
