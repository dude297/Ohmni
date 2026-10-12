import { useSyncExternalStore } from 'react';
import type { Dispatch } from 'react';
import type { HoleId } from './_model';
import type { Action, StudioState } from './_state';
import type { View } from './_geometry';

export type BoardProps = {
  state: StudioState;
  dispatch: Dispatch<Action>;
  netHoles: HoleId[]; // copper highlight
  faultHoles: HoleId[]; // fault red pulse
  reduced: boolean;
  view?: { name: View; nonce: number };
};

const Q = '(prefers-reduced-motion: reduce)';
export function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(Q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(Q).matches,
    () => false,
  );
}

export const fmtV = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(3)} V`);
export const fmtOhm = (r: number) => (r >= 1e6 ? `${r / 1e6} MΩ` : r >= 1e3 ? `${r / 1e3} kΩ` : `${r} Ω`);
