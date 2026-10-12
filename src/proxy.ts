import { NextResponse, type NextRequest } from 'next/server';
import { check } from '@/lib/server/rateLimit';

export function proxy(req: NextRequest) {
  const b = check(req.method, req.nextUrl.pathname, req.headers);
  if (!b) return NextResponse.next();
  return NextResponse.json(
    { error: { code: b.code, message: b.message } },
    { status: b.status, headers: b.retryAfter ? { 'Retry-After': String(b.retryAfter) } : undefined },
  );
}

// Next requires a static matcher; keep in sync with LIMITED_ROUTES (tests/server/rateLimit.test.ts checks).
export const config = {
  matcher: [
    '/api/extract', '/api/solve', '/api/explain', '/api/review', '/api/ac', '/api/probe', '/api/probe-multi',
    '/api/topology', '/api/repair', '/api/repair/verify', '/api/twin', '/api/firmware/adc',
  ],
};
