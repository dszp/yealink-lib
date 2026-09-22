/**
 * Shared test helpers — a recording mock `fetch` that speaks YMCS's shapes, including the token
 * endpoint, so every client test starts authenticated without a real credential.
 *
 * NOT part of the shipped library: excluded from the tsc build so it never lands in `dist/`.
 * Kept Node-free (Web `Response` only) like the rest of src/.
 */

export interface RecordedCall {
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Parsed JSON body; the raw string if not JSON; `undefined` when no body was sent. */
  body: unknown;
}

export interface MockResponse {
  status?: number;
  /** JSON body. Ignored when `rawBody` is set. */
  body?: unknown;
  /** Verbatim body (exercises the parse guard). */
  rawBody?: string;
}

export type Route = MockResponse | ((call: RecordedCall) => MockResponse);

export interface MockFetchOptions {
  /** Response for `POST /v2/token`. Defaults to a valid one-day token. */
  token?: MockResponse;
  /** Per-`"METHOD /path"` responses. A function sees the recorded call. */
  routes?: Record<string, Route>;
  /** Catch-all for anything not in `routes` (and not the token endpoint). Default `{}` 200. */
  fallback?: Route;
}

export const FAKE_TOKEN = 'test-access-token';

export function mockFetch(opts: MockFetchOptions = {}): { fetchImpl: typeof fetch; calls: RecordedCall[]; apiCalls: () => RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const query: Record<string, string> = {};
    u.searchParams.forEach((v, k) => (query[k] = v));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k] = v;
    let body: unknown = undefined;
    if (init?.body !== undefined) {
      try {
        body = JSON.parse(String(init.body));
      } catch {
        body = String(init.body);
      }
    }
    const call: RecordedCall = { method: (init?.method ?? 'GET').toUpperCase(), url: String(url), path: u.pathname, query, headers, body };
    calls.push(call);

    let resp: MockResponse;
    if (call.path === '/v2/token') {
      resp = opts.token ?? { body: { access_token: FAKE_TOKEN, token_type: 'bearer', expires_in: 86400 } };
    } else {
      const r = opts.routes?.[`${call.method} ${call.path}`] ?? opts.fallback ?? { body: {} };
      resp = typeof r === 'function' ? r(call) : r;
    }
    const status = resp.status ?? 200;
    const h = { 'Content-Type': 'application/json' };
    if (resp.rawBody !== undefined) return new Response(resp.rawBody, { status, headers: h });
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(resp.body ?? {}), { status, headers: h });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls, apiCalls: () => calls.filter((c) => c.path !== '/v2/token') };
}

/** A page in YMCS's list shape. */
export function page<T>(data: T[], total: number, skip = 0, limit = data.length): { skip: number; limit: number; total: number; data: T[] } {
  return { skip, limit, total, data };
}

export const CREDS = { clientId: 'ak-test-0001', clientSecret: 'not-a-real-secret', region: 'us' as const };
