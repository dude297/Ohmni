// Server-side only: eecircuit-engine embeds ngspice (WASM, ~20 MB). Never import from client code.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { buildNetlist, DEFAULT_SWEEP, type AcSweep } from './netlist';
import type { AcGraph, Curve } from './types';

export const ENGINE_VERSION = '1.8.0'; // asserted equal to the installed package in tests
export const SIM_TIMEOUT_MS = 10_000;
export const MAX_QUEUE = 3;

export class AcError extends Error {
  constructor(public code: 'BUSY' | 'TIMEOUT' | 'SIM_FAILED', message: string) {
    super(message);
  }
}

type Cx = { real: number; img?: number; imag?: number };
type Reply = { ok: true; names: string[]; cols: (number | Cx)[][] } | { ok: false; error: string };

// eecircuit-engine sets globalThis.window = {} inside start(), which makes Next.js think it is in a browser and 500 every
// route. So the engine lives in its own worker thread: isolated globals, and a real kill switch on timeout.
const WORKER_SRC = `
const { parentPort, workerData } = require('node:worker_threads');
let sim;
parentPort.on('message', async (net) => {
  try {
    if (!sim) {
      const { Simulation } = await import(workerData.url);
      sim = new Simulation();
      await sim.start();
    }
    sim.setNetList(net);
    const r = await sim.runSim();
    parentPort.postMessage({ ok: true, names: r.variableNames, cols: r.data.map((d) => d.values) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
  }
});`;

let worker: Worker | null = null;
function getWorker(): Worker {
  // ponytail: path from cwd (next start / vitest run from repo root); Vercel would need outputFileTracingIncludes.
  const url = pathToFileURL(join(process.cwd(), 'node_modules/eecircuit-engine/dist/eecircuit-engine.mjs')).href;
  if (!worker) (worker = new Worker(WORKER_SRC, { eval: true, workerData: { url } })).unref();
  return worker;
}

function simulate(net: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const done = () => {
      clearTimeout(t);
      w.off('message', onMsg);
      w.off('error', onErr);
      w.off('exit', onExit);
    };
    const kill = () => {
      worker = null;
      void w.terminate();
    };
    const onMsg = (m: Reply) => (done(), resolve(m));
    const onErr = (e: Error) => (done(), kill(), reject(new AcError('SIM_FAILED', e.message)));
    const onExit = () => (done(), (worker = null), reject(new AcError('SIM_FAILED', 'simulator exited')));
    const t = setTimeout(() => (done(), kill(), reject(new AcError('TIMEOUT', `Simulation exceeded ${SIM_TIMEOUT_MS} ms`))), SIM_TIMEOUT_MS);
    w.on('message', onMsg).on('error', onErr).on('exit', onExit).postMessage(net);
  });
}

// ponytail: single promise chain = one sim at a time. Upgrade path: worker pool if throughput matters.
let tail: Promise<unknown> = Promise.resolve();
let waiting = 0;

function queued<T>(job: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_QUEUE + 1) return Promise.reject(new AcError('BUSY', 'Simulator busy, try again shortly'));
  waiting++;
  const run = tail.then(job, job).finally(() => waiting--);
  tail = run.catch(() => undefined);
  return run;
}

const re = (c: number | Cx) => (typeof c === 'number' ? c : c.real);
const im = (c: number | Cx) => (typeof c === 'number' ? 0 : (c.img ?? c.imag ?? 0));

export type RawAc = { freq: number[]; out: [number, number][]; src: [number, number][] };

/** Run one AC sweep; returns complex node voltage at outputNode and complex source current. */
export function runAcRaw(g: AcGraph, sweep: AcSweep = DEFAULT_SWEEP): Promise<RawAc> {
  const { text, outputToken, sourceToken } = buildNetlist(g, sweep);
  return queued(async () => {
    const r = await simulate(text);
    if (!r.ok) throw new AcError('SIM_FAILED', r.error);
    const idx = (n: string) => r.names.findIndex((v) => v.toLowerCase() === n);
    const iF = idx('frequency');
    const iO = idx(`v(${outputToken})`);
    const iS = idx(`i(${sourceToken})`);
    if (iF < 0 || iO < 0) throw new AcError('SIM_FAILED', 'simulator returned no data (circuit may be floating or singular)');
    const pair = (i: number): [number, number][] => r.cols[i].map((c) => [re(c), im(c)]);
    return { freq: r.cols[iF].map(re), out: pair(iO), src: iS >= 0 ? pair(iS) : [] };
  });
}

export const toCurve = (r: RawAc): Curve => ({
  freq: r.freq,
  magDb: r.out.map(([a, b]) => 20 * Math.log10(Math.hypot(a, b))),
  phaseDeg: r.out.map(([a, b]) => (Math.atan2(b, a) * 180) / Math.PI),
});

export async function runAc(g: AcGraph, sweep?: AcSweep): Promise<Curve> {
  return toCurve(await runAcRaw(g, sweep));
}
