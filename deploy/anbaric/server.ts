// Anbaric Cloud entry: serves the PREBUILT Next.js app (.next shipped in the bundle)
// in-process, so every API route (vision extract, solver, diagnosis, explain) runs on Anbaric.
// ponytail: Anbaric has no build step and `next build` stalls on 0.25 vCPU, so the build is done
// locally by build.mjs and shipped; the platform only runs `npm install` + this file.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { SecretStoreFactory, SystemActor } from 'anbaric';

// OHMNI_SELFTEST (optional secret): 'basic' | 'live' -> run scripts/smoke.mjs against this container at boot.
const SECRETS = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'BEATAPI_API_KEY', 'OHMNI_SELFTEST'];
// Non-secret config (matches the Vercel production values).
const DEFAULTS: Record<string, string> = {
  GEMINI_MODEL: 'gemini-3.5-flash-lite',
  VISION_PRIMARY: 'groq',
  BEATAPI_JEV_MODEL: 'jev-1.13-free',
  NEXT_TELEMETRY_DISABLED: '1',
};
for (const [k, v] of Object.entries(DEFAULTS)) process.env[k] ??= v;
try {
  process.env.BUILD_SHA ??= readFileSync(new URL('./BUILD_SHA', import.meta.url), 'utf8').trim();
} catch { /* optional */ }

const store = SecretStoreFactory.instance();
for (const name of SECRETS) {
  if (process.env[name]) continue;
  try {
    process.env[name] = (await store.retrieve(name, SystemActor.actor)).trim();
    console.log(`[ohmni] secret ${name}: loaded`);
  } catch (e) {
    console.log(`[ohmni] secret ${name}: MISSING (${(e as Error).message})`); // never logs values
  }
}

// Import Next only AFTER env is populated: @next/env snapshots process.env on first load
// and resets to that snapshot in prepare(), which would drop the secrets set above.
const { default: next } = await import('next');
const port = Number(process.env.PORT ?? 3000);
const app = next({ dev: false, dir: fileURLToPath(new URL('.', import.meta.url)) });
const handle = app.getRequestHandler();
await app.prepare();
createServer((req, res) => handle(req, res)).listen(port, () => {
  console.log(`[ohmni] next ready on :${port}`);
  // Boot self-test: proves the deployed container serves the real app + models. 'live' = 1 vision call per boot,
  // so delete the secret after use (`anbaric secrets delete OHMNI_SELFTEST`).
  const mode = process.env.OHMNI_SELFTEST;
  if (mode === 'probe') { // no-quota egress check: list models, log status only
    fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}` } })
      .then(async (r) => console.log(`[ohmni] probe groq /models -> ${r.status} ${(await r.text()).slice(0, 160).replace(/\s+/g, ' ')}`))
      .catch((e) => console.log(`[ohmni] probe groq failed: ${(e as Error).message}`));
  }
  if (mode !== 'basic' && mode !== 'live') return;
  const args = ['smoke.mjs', `http://127.0.0.1:${port}`, ...(mode === 'live' ? ['--live'] : [])];
  spawn(process.execPath, args, { cwd: fileURLToPath(new URL('.', import.meta.url)), stdio: 'inherit' });
});
