// Builds Ohmni locally and assembles the Anbaric bundle in deploy/anbaric/out.
// Usage (repo root):  node deploy/anbaric/build.mjs   then   cd deploy/anbaric/out; anbaric app update
// Vercel is untouched: this only reads the normal `next build` output.
import { execSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, 'out');

if (!process.argv.includes('--skip-build')) execSync('npx next build', { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, '.next'), join(out, '.next'), {
  recursive: true,
  filter: (src) => !/[\\/]\.next[\\/](cache|dev|diagnostics|trace)/.test(src),
});
cpSync(join(root, 'public'), join(out, 'public'), { recursive: true });
cpSync(join(root, 'next.config.ts'), join(out, 'next.config.ts'));
cpSync(join(here, 'server.ts'), join(out, 'server.ts'));
cpSync(join(root, 'scripts', 'smoke.mjs'), join(out, 'smoke.mjs'));
cpSync(join(here, '.anbaric'), join(out, '.anbaric'), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(out, 'package.json'), JSON.stringify({
  name: 'ohmni',
  version: pkg.version,
  private: true,
  type: 'module',
  main: 'server.ts',
  dependencies: { ...pkg.dependencies, anbaric: '^1.68.3' },
}, null, 2));
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
writeFileSync(join(out, 'BUILD_SHA'), `anbaric-${sha}\n`);
console.log(`bundle ready: ${out}`);
