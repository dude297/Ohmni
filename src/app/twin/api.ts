export type Api<T> = { ok: true; data: T } | { ok: false; unavailable?: boolean; error: string };

/** POST helper: 404 => "not available on this build" (the endpoint may live on another branch). */
export async function api<T>(url: string, payload: unknown): Promise<Api<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    if (res.status === 404) return { ok: false, unavailable: true, error: "not available on this build" };
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.result) {
      const e = body?.error;
      const detail = Array.isArray(e?.details) && e.details.length ? ` (${e.details[0]})` : "";
      return { ok: false, error: `${typeof e === "string" ? e : e?.message ?? `Request failed (${res.status}).`}${detail}` };
    }
    return { ok: true, data: body.result as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error." };
  }
}
