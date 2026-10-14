import { NextResponse, type NextRequest } from 'next/server';
import { check } from '@/lib/server/rateLimit';
import { checkShared } from '@/lib/server/sharedLimit';
import { disabledTiers, tierOf } from '@/lib/features';

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const tier = tierOf(path);
  const tierHeader = tier ? { 'x-ohmni-tier': tier } : undefined;
  if (tier && disabledTiers().has(tier)) {
    if (path.startsWith('/api/'))
      return NextResponse.json({ error: { code: 'FEATURE_DISABLED', message: 'This feature is not available on this deployment.' } }, { status: 404, headers: tierHeader });
    return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain', ...tierHeader } });
  }
  const b = check(req.method, path, req.headers) ?? (await checkShared(req.method, path, req.headers));
  if (!b) {
    const res = NextResponse.next();
    if (tier) res.headers.set('x-ohmni-tier', tier);
    return res;
  }
  return NextResponse.json(
    { error: { code: b.code, message: b.message } },
    { status: b.status, headers: { ...tierHeader, ...(b.retryAfter && { 'Retry-After': String(b.retryAfter) }) } },
  );
}

// Every page and API route; skips Next internals and static files (anything with a dot). tests/server/rateLimit.test.ts checks coverage.
export const config = {
  matcher: ['/((?!_next/|.*\\..*).*)'],
};
