# Ohmni on Anbaric Cloud

**Primary URL:** https://ohmni.cloud.anbaric.ai (the app's own address, served at root)
**Alt path:** https://cloud.anbaric.ai/app/ohmni/
**Public fallback (no login):** https://multimodal-hackathon-sage.vercel.app (unchanged)

> **Access:** Anbaric Cloud's app proxy is auth-walled by design. Every request (including `/api/health`)
> gets a `302` to Anbaric's Auth0 login. Visitors need an Anbaric account signed into the
> tenant (or organizer-provided access). There is no documented anonymous/public mode on the managed cloud
> (anonymous access exists only on a self-hosted platform). We did not bypass it. Judges without an Anbaric
> login should use the Vercel URL.

## Architecture

The same Next.js app as Vercel, running entirely on Anbaric. Nothing calls Vercel.

```
browser (Anbaric session) -> Anbaric proxy (auth) -> container: tsx server.ts
                                                      ├─ loads keys from Anbaric Secret Store into process.env
                                                      └─ Next.js (prebuilt .next, in-process) -> /lab, /probe, /api/*
                                                            /api/extract  -> Groq / Gemini vision + Jev router (BeatAPI)
                                                            /api/solve    -> MNA solver + diagnosis (in-process)
                                                            /api/explain  -> Gemini
```

- **Why prebuilt:** Anbaric has no build step (it runs `npm install` and then the `main` entry with tsx). The earlier
  build-at-boot spike (`circuitscout`, `next build` inside the container) never completed on 0.25 vCPU. Its logs
  stop at "Creating an optimized production build" and the admin process is down.
- **Bundle:** `deploy/anbaric/build.mjs` runs the normal `next build` and assembles `deploy/anbaric/out/`
  (gitignored): `.next` (without cache), `public`, `next.config.ts`, `server.ts`, `smoke.mjs`, a generated
  `package.json` (`type: module`, `main: server.ts`, runtime deps + `anbaric`), `.anbaric/app-config.json`
  (`{name: ohmni, internalPort: 3000}`) and `BUILD_SHA`. The deploy packer only excludes `node_modules`, so `.next` ships.
- **Vercel is untouched:** `next.config.ts` is unchanged, and there are no Vercel env or project changes. The only shared-code change is that
  `/api/health` is now request-time (`await connection()`) instead of prerendered at build. Without that it would
  report build-time env (all `configured:false`) on Anbaric.
- Next is imported **after** secrets are loaded, because `@next/env` snapshots `process.env` on first load and resets
  to that snapshot in `prepare()`.

## Deploy (Windows: run `anbaric app deploy/update` from PowerShell; Git-Bash GNU tar fails on C:\ paths)

```
npm ci
node deploy/anbaric/build.mjs          # next build + assemble deploy/anbaric/out
cd deploy/anbaric/out
anbaric app update                     # first time: anbaric app deploy --yes
anbaric app status ohmni
anbaric app tail ohmni                 # Ctrl-C to stop
```

## Secrets / env (names only)

Set once per app through the Anbaric Secret Store. The value is piped on stdin and never appears on the command line:

```
printf '%s' "$VALUE" | anbaric secrets set GROQ_API_KEY --app ohmni      # also GEMINI_API_KEY, BEATAPI_API_KEY
anbaric secrets list --app ohmni
```

- Secrets: `GROQ_API_KEY`, `GEMINI_API_KEY`, `BEATAPI_API_KEY`. They are read at boot, so after you change one, run `anbaric app update`.
- Non-secret config is hardcoded in `server.ts` to match Vercel: `GEMINI_MODEL=gemini-3.5-flash-lite`,
  `VISION_PRIMARY=groq`, `BEATAPI_JEV_MODEL=jev-1.13-free`.
- Optional `OHMNI_SELFTEST` = `basic` | `live` | `probe` runs `smoke.mjs` against the container at boot and writes the results
  to the logs. `live` makes 1 vision call per boot, so **delete it after use** (`anbaric secrets delete OHMNI_SELFTEST --app ohmni`).
- **Gotcha:** piping a secret from Windows PowerShell 5.1 corrupted the Groq key. Groq returned 403 from the container
  even though the key returned 200 locally. Re-setting the key from Git-Bash fixed it. Set secrets from bash.

## Runtime limits (documented)

0.25 vCPU / 1 GB per container (about 510 MB Node heap). Ohmni handles one request at a time per step and fits easily.
No build step. Requests to the app need a platform session (30-day sliding). A POST with an expired session returns `401`.

## Pricing (documented facts only)

$20/mo per app unless it is covered by the free allowance. The large instance ($50/mo) is **not** enabled. Any promotional or hackathon
entitlement is **unverified**: check the console's Manage apps page.
The `circuitscout` spike app is still deployed and running a broken build-at-boot. The owner may tear it down
(`anbaric app tear-down circuitscout`) so it doesn't use an app slot or allowance.

## Verification (2026-10-11)

- `anbaric app status ohmni` → `deploy running  admin up`; `anbaric apps` → `ohmni running 3000`.
- Boot self-test run **inside the Anbaric container** against `http://127.0.0.1:3000` (logs via `anbaric app tail ohmni`):
  12/12 PASS. Results: `/` 200 with "Ohmni"; `/lab` 200; `/api/health` with build `anbaric-dbb5996` and all three providers
  `configured:true`; solve 10k/10k gives VOUT=2.5 and 10k/1k gives 0.454545; diagnosis with 0.45 V puts "R2 may be 1 kΩ
  instead of 10 kΩ" first; the 422 and 400 negative cases pass; **LIVE /api/extract** on `public/samples/clear-divider.png` →
  route `review_extraction`, graph `V1=5V, R1=10000ohm, R2=10000ohm measure=VOUT`, Groq qwen3.8-27b ok (1056 ms)
  and Jev jev-1.13-free ok (413 ms).
- From outside: `GET https://ohmni.cloud.anbaric.ai/` → `302` to the Anbaric Auth0 login, which is expected.
- Not yet done: a click-through in a signed-in browser. No browser automation was available to the agent. The owner
  checklist is below.

## Owner click-through (signed into Anbaric)

1. Open https://ohmni.cloud.anbaric.ai and sign in. The Ohmni landing page renders.
2. Open https://ohmni.cloud.anbaric.ai/api/health. You should see `build: anbaric-…` and `configured: true` for gemini, groq and jev.
3. Open `/lab`, load the sample divider, and run extraction. You should get the review screen with V1=5 V, R1=R2=10 kΩ.
4. Confirm, then solve. VOUT should be 2.5 V. Enter a measured 0.45 V. The top hypothesis should be R2 = 1 kΩ. The explanation should render.
5. In an incognito window, open the same URL. It redirects to the Anbaric login. This confirms visitors need an account.

## Vercel fallback

If Anbaric is unreachable or judges can't sign in, use https://multimodal-hackathon-sage.vercel.app. It is the same code with no
login. Nothing on Vercel depends on Anbaric.
