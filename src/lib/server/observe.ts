// Per-request observability for API routes: request id, one JSON log line, requestId in error bodies, catch-all 500.
// Logs carry metadata only: never bodies, images, graphs, tokens, keys, IPs or provider responses.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestIdOf(req: Request): string {
  const incoming = req.headers.get('x-request-id');
  return incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
}

export function observe<A extends unknown[]>(route: string, handler: (req: Request, ...rest: A) => Response | Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const t0 = performance.now();
    const requestId = requestIdOf(req);
    let res: Response;
    let code: string | undefined;
    let errorName: string | undefined;
    try {
      res = await handler(req, ...rest);
    } catch (e) {
      errorName = e instanceof Error ? e.name : typeof e; // name only: messages can carry user data or secrets
      res = Response.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, { status: 500 });
    }
    let body: BodyInit | null = res.body;
    if (res.status >= 400 && res.headers.get('content-type')?.includes('application/json')) {
      try {
        const json = await res.clone().json();
        if (json?.error && typeof json.error === 'object') {
          code = typeof json.error.code === 'string' ? json.error.code : undefined;
          json.error.requestId = requestId;
          body = JSON.stringify(json);
        }
      } catch {
        // non-JSON error body: pass through unchanged
      }
    }
    const headers = new Headers(res.headers);
    headers.set('x-request-id', requestId);
    if (body !== res.body) headers.delete('content-length');
    const line = { ts: new Date().toISOString(), requestId, route, method: req.method, status: res.status, ms: Math.round(performance.now() - t0), ...(code && { code }), ...(errorName && { error: errorName }) };
    (res.status >= 500 ? console.error : console.log)(JSON.stringify(line));
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  };
}
