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
In-memory limits are **per server instance**. For the model-calling routes (`/api/extract`, `/api/explain`, `/api/review`) a **shared Postgres counter** (`src/lib/server/sharedLimit.ts`, `public.rate_hit`, migration `20261014030000_shared_rate_limit.sql`) enforces the same per-IP limits and per-route model budget across instances whenever Supabase is configured. It fails open to the in-memory limits (database down or > 1.5 s), so it is abuse damping plus quota protection, not a hard guarantee. Other routes (local engines) remain per instance. Platform firewall rules (Vercel) are the backstop.

## Feature tiers (`src/lib/features.ts`, `src/proxy.ts`)
Every page and API route listed in `TIERS` gets `x-ohmni-tier: core|experimental|demo` (tier list in PRODUCTION_PHASE1.md). `OHMNI_DISABLED_TIERS=experimental,demo` (or `OHMNI_EXPERIMENTAL=off`) makes those API routes return 404 `FEATURE_DISABLED` JSON and those pages a plain 404. Unset = everything served. Core can't be disabled.

## Security headers (`next.config.ts`)
All routes: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: microphone=(self), camera=(), geolocation=(), payment=(), usb=()` (Voice Lab needs the microphone), `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
CSP is **enforced** (`Content-Security-Policy`): self-only sources, `'unsafe-inline'` scripts/styles (required by Next's inline scripts; without it the app breaks with 100+ violations), `img-src data: blob:` for upload previews, no `unsafe-eval`, no `wasm-unsafe-eval` (ngspice runs server-side), no workers, `object-src 'none'`, `frame-ancestors 'none'`. Verified with `scripts/csp-smoke.mjs` against a production build: every page route, safe sample/example interactions, zero violations and zero page errors. The only blocked action is zod v4's `Function('')` feature probe, which zod catches and falls back to its non-JIT validator (`z.config({ jitless: true })` in client code would silence it). Re-run after adding pages, third-party scripts, fonts, workers or WASM in the browser: `node scripts/csp-smoke.mjs <url>` (needs Playwright; see the script header). `--force-enforce` with `CSP_OVERRIDE` tests a candidate policy without rebuilding. The post-deploy smoke fails if the enforcing header disappears.

## Post-deploy smoke
`.github/workflows/postdeploy.yml` (push to main, no secrets) runs `npm run smoke:postdeploy -- <url> <sha>`: waits up to 10 min for `/api/health` `build` to equal the pushed commit, then checks `/api/solve` (divider = 2.5 V, bad JSON = 400) and `/probe` headers. No model calls.
