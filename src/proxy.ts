import { NextResponse, type NextRequest } from 'next/server';
import { check } from '@/lib/server/rateLimit';
import { disabledTiers, tierOf } from '@/lib/features';
import { requestIdOf } from '@/lib/server/observe';

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const tier = tierOf(path);
  const tierHeader = tier ? { 'x-ohmni-tier': tier } : undefined;
  // Responses the proxy answers itself never reach observe(); give them the same request id contract.
  if (tier && disabledTiers().has(tier)) {
    const requestId = requestIdOf(req);
    if (path.startsWith('/api/'))
      return NextResponse.json({ error: { code: 'FEATURE_DISABLED', message: 'This feature is not available on this deployment.', requestId } }, { status: 404, headers: { ...tierHeader, 'x-request-id': requestId } });
    return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain', ...tierHeader, 'x-request-id': requestId } });
  }
  const b = check(req.method, path, req.headers);
  if (!b) {
    const res = NextResponse.next();
    if (tier) res.headers.set('x-ohmni-tier', tier);
    return res;
  }
  const requestId = requestIdOf(req);
  return NextResponse.json(
    { error: { code: b.code, message: b.message, requestId } },
    { status: b.status, headers: { ...tierHeader, 'x-request-id': requestId, ...(b.retryAfter && { 'Retry-After': String(b.retryAfter) }) } },
  );
}

// Every page and API route; skips Next internals and static files (anything with a dot). tests/server/rateLimit.test.ts checks coverage.
export const config = {
  matcher: ['/((?!_next/|.*\\..*).*)'],
};
