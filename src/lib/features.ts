// Feature tiers (docs/PRODUCTION_PHASE1.md). One map: route prefix -> tier. Unlisted routes (e.g. "/") are untiered and never gated.
export type Tier = 'core' | 'experimental' | 'demo';

export const TIERS: Record<string, Tier> = {
  '/lab': 'core', '/probe': 'core', '/build': 'core',
  '/api/extract': 'core', '/api/solve': 'core', '/api/probe': 'core', '/api/repair': 'core', '/api/health': 'core',
  '/review': 'experimental', '/multi-fault': 'experimental', '/twin': 'experimental', '/studio': 'experimental',
  '/ac': 'experimental', '/teams': 'experimental',
  '/api/review': 'experimental', '/api/probe-multi': 'experimental', '/api/twin': 'experimental', '/api/ac': 'experimental',
  '/api/topology': 'experimental', '/api/firmware': 'experimental', '/api/explain': 'experimental',
  '/learn': 'demo', '/tracks': 'demo', '/for-the-larp': 'demo',
};

/** Exact segment-prefix match: '/api/probe' covers '/api/probe/x' but not '/api/probe-multi'. */
export function tierOf(pathname: string): Tier | null {
  let best: string | null = null;
  for (const k of Object.keys(TIERS))
    if ((pathname === k || pathname.startsWith(k + '/')) && (!best || k.length > best.length)) best = k;
  return best ? TIERS[best] : null;
}

/** OHMNI_DISABLED_TIERS="experimental,demo"; OHMNI_EXPERIMENTAL=off is an alias for disabling experimental. Core is never disabled. */
export function disabledTiers(env: Record<string, string | undefined> = process.env): Set<Tier> {
  const s = new Set((env.OHMNI_DISABLED_TIERS ?? '').split(',').map((t) => t.trim()).filter((t): t is Tier => t === 'experimental' || t === 'demo'));
  if (env.OHMNI_EXPERIMENTAL === 'off') s.add('experimental');
  return s;
}
