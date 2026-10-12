# /studio — interactive 3D circuit studio

Originally `moonshot/studio-3d`, now merged through [#69](https://github.com/dude297/Ohmni/pull/69). Experimental split view: intended schematic (SVG) and virtual breadboard build (React Three Fiber, with a keyboard-accessible 2D top-view fallback). The local tests/captures below are not current production-host verification.

- Model: `@/lib/breadboard` (merged from `moonshot/studio-breadboard` @ bfd1810). `src/app/studio/_model.ts` only adds UI helpers (hole parsing, net lookups). Connectivity is strips + explicit jumper ends, never proximity.
- Example: 5 V divider on a half board. The "mistake" preset puts jumper J2 on c15 (R2's pin is column 14), splitting VOUT. Fix it by selecting J2, clicking an end (or "Move end B"), then clicking c14.
- Every edit bumps `revision`, clears the confirmation and any solver result, and recomputes nets + diff client-side. Built voltages come from `POST /api/solve` only after the "I confirm this build" checkbox; intended voltages use the local deterministic solver (SIMULATED).
- Deps added (React 19 compatible): `three@0.186`, `@react-three/fiber@9.8` (peer react `>=19 <19.4`), `@types/three`. No drei. 3D chunk is lazy (`ssr:false`), about 242 KB gzip; /studio initial JS about 220 KB gzip (/lab: about 193 KB).
- Not built: bridge example, camera tweens and assembly animation (views jump-cut; also reduced-motion safe), current arrows in 3D (schematic shows /api/solve currents once confirmed).
- Tests: `npx vitest run tests/studio-ui`; browser: `E2E_DIR=%TEMP%\ohmni-e2e BASE=http://localhost:3107 node tests/studio-ui/studio.e2e.mjs` against `npm run start`. Screenshots in `docs/ui-review/studio/`.
