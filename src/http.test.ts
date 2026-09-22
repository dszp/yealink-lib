import { describe, expect, it } from 'vitest';
import { memoryCache } from './cache.js';
import { TOKEN_REFRESH_SKEW_MS, YmcsApiError, YmcsHttp } from './http.js';
import { CREDS, FAKE_TOKEN, mockFetch } from './testkit.js';

describe('YmcsHttp token lifecycle', () => {
  it('mints once, then reuses the token; every call gets fresh replay headers', async () => {
    const mock = mockFetch();
    const http = new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl });
    await http.request('GET', '/v2/dm/sites/site-0001');
    await http.request('GET', '/v2/dm/sites/site-0002');
    expect(mock.calls.map((c) => c.path)).toEqual(['/v2/token', '/v2/dm/sites/site-0001', '/v2/dm/sites/site-0002']);
    const [, a, b] = mock.calls;
    expect(a.headers.Authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(a.headers.nonce).not.toBe(b.headers.nonce);
    expect(a.headers.timestamp).toMatch(/^\d+$/);
  });

  it('single-flights concurrent first requests through one token exchange', async () => {
    const mock = mockFetch();
    const http = new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl });
    await Promise.all([http.request('GET', '/v2/dm/a'), http.request('GET', '/v2/dm/b'), http.request('GET', '/v2/dm/c')]);
    expect(mock.calls.filter((c) => c.path === '/v2/token')).toHaveLength(1);
  });

  it('re-mints before expiry, using the skew', async () => {
    let now = 1_000_000;
    const mock = mockFetch({ token: { body: { access_token: 't', expires_in: 3600 } } });
    const http = new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl, now: () => now });
    await http.request('GET', '/v2/dm/x');
    now += 3600 * 1000 - TOKEN_REFRESH_SKEW_MS - 1; // still inside the window
    await http.request('GET', '/v2/dm/x');
    expect(mock.calls.filter((c) => c.path === '/v2/token')).toHaveLength(1);
    now += 2; // past the skew edge
    await http.request('GET', '/v2/dm/x');
    expect(mock.calls.filter((c) => c.path === '/v2/token')).toHaveLength(2);
  });

  it('shares a token across instances through the cache, keyed by host and client id', async () => {
    const now = () => 5_000_000;
    const cache = memoryCache(now);
    const m1 = mockFetch();
    const m2 = mockFetch();
    await new YmcsHttp({ ...CREDS, fetchImpl: m1.fetchImpl, tokenCache: cache, now }).request('GET', '/v2/dm/x');
    await new YmcsHttp({ ...CREDS, fetchImpl: m2.fetchImpl, tokenCache: cache, now }).request('GET', '/v2/dm/x');
    expect(m1.calls.map((c) => c.path)).toEqual(['/v2/token', '/v2/dm/x']);
    expect(m2.calls.map((c) => c.path)).toEqual(['/v2/dm/x']);
    const stored = await cache.get('ymcs:token:us-api.ymcs.yealink.com:ak-test-0001');
    expect(stored).toContain(FAKE_TOKEN);
    expect(stored).not.toContain('not-a-real-secret');
  });

  it('a different client id does not share the cached token', async () => {
    const now = () => 5_000_000;
    const cache = memoryCache(now);
    const m1 = mockFetch();
    const m2 = mockFetch();
    await new YmcsHttp({ ...CREDS, fetchImpl: m1.fetchImpl, tokenCache: cache, now }).request('GET', '/v2/dm/x');
    await new YmcsHttp({ ...CREDS, clientId: 'ak-test-0002', fetchImpl: m2.fetchImpl, tokenCache: cache, now }).request('GET', '/v2/dm/x');
    expect(m2.calls[0].path).toBe('/v2/token');
  });

  it('ignores a corrupt cache entry', async () => {
    const cache = memoryCache();
    await cache.put('ymcs:token:us-api.ymcs.yealink.com:ak-test-0001', 'not json', 600);
    const mock = mockFetch();
    await new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl, tokenCache: cache }).request('GET', '/v2/dm/x');
    expect(mock.calls[0].path).toBe('/v2/token');
  });

  it('on 401 refreshes once and retries once; a second 401 is the answer', async () => {
    let tokens = 0;
    const mock = mockFetch({
      token: { body: { access_token: `tok-${++tokens}`, expires_in: 86400 } },
      routes: { 'GET /v2/dm/x': (c) => (c.headers.Authorization === 'Bearer tok-1' ? { status: 401, body: { code: '401', message: 'expired' } } : { body: { ok: true } }) },
    });
    // The mock's token body is fixed at construction; make it count.
    const fetchImpl: typeof fetch = ((u: string, i?: RequestInit) => {
      if (String(u).endsWith('/v2/token')) tokens++;
      return mock.fetchImpl(u, i);
    }) as typeof fetch;
    const http = new YmcsHttp({ ...CREDS, fetchImpl });
    const err: any = await http.request('GET', '/v2/dm/x').catch((e) => e);
    // The mock only ever issues tok-1, so the retry 401s too and surfaces.
    expect(err).toBeInstanceOf(YmcsApiError);
    expect(err.status).toBe(401);
    expect(mock.calls.map((c) => c.path)).toEqual(['/v2/token', '/v2/dm/x', '/v2/token', '/v2/dm/x']);
  });

  it('a 401 with a fresh token succeeds on the retry', async () => {
    let issued = 0;
    const fetchImpl: typeof fetch = (async (u: string, i?: RequestInit) => {
      if (String(u).endsWith('/v2/token')) {
        issued++;
        return new Response(JSON.stringify({ access_token: `tok-${issued}`, expires_in: 86400 }), { status: 200 });
      }
      const auth = (i?.headers as Record<string, string>).Authorization;
      if (auth === 'Bearer tok-1') return new Response(JSON.stringify({ message: 'expired' }), { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const http = new YmcsHttp({ ...CREDS, fetchImpl });
    expect(await http.request('GET', '/v2/dm/x')).toEqual({ ok: true });
    expect(issued).toBe(2);
  });
});

describe('YmcsHttp request semantics', () => {
  it('undefined body sends no body; {} sends {}', async () => {
    const mock = mockFetch();
    const http = new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl });
    await http.request('POST', '/v2/dm/a');
    await http.request('POST', '/v2/dm/b', { body: {} });
    const [, a, b] = mock.calls;
    expect(a.body).toBeUndefined();
    expect(a.headers['Content-Type']).toBeUndefined();
    expect(b.body).toEqual({});
    expect(b.headers['Content-Type']).toBe('application/json');
  });

  it('query params are appended and undefined ones dropped', async () => {
    const mock = mockFetch();
    await new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl }).request('GET', '/v2/dm/models', { query: { deviceType: 1, x: undefined } });
    expect(mock.calls[1].query).toEqual({ deviceType: '1' });
  });

  it('204 normalizes to {}', async () => {
    const mock = mockFetch({ routes: { 'PATCH /v2/dm/sites/site-0001': { status: 204 } } });
    expect(await new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl }).request('PATCH', '/v2/dm/sites/site-0001', { body: { name: 'x' } })).toEqual({});
  });

  it('unwraps the YMCS error envelope including details', async () => {
    const mock = mockFetch({
      routes: { 'POST /v2/dm/devices': { status: 400, body: { code: '900001', requestId: 'req-1', message: 'invalid', details: [{ field: 'mac', message: 'bad mac' }] } } },
    });
    const err: any = await new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl }).request('POST', '/v2/dm/devices', { body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(YmcsApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe('900001');
    expect(err.requestId).toBe('req-1');
    expect(err.details).toEqual([{ field: 'mac', message: 'bad mac' }]);
    expect(err.message).toBe('POST /v2/dm/devices → 400: invalid — code 900001 — mac: bad mac');
  });

  it('a 412 explains the bodyless-POST trap', async () => {
    const mock = mockFetch({ routes: { 'POST /v2/dm/listSites': { status: 412, rawBody: '' } } });
    const err: any = await new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl }).request('POST', '/v2/dm/listSites').catch((e) => e);
    expect(err.message).toMatch(/send \{\} instead/);
  });

  it('a non-JSON error body surfaces as YmcsApiError carrying the status', async () => {
    const mock = mockFetch({ routes: { 'GET /v2/dm/x': { status: 502, rawBody: '<html>gateway</html>' } } });
    const err: any = await new YmcsHttp({ ...CREDS, fetchImpl: mock.fetchImpl }).request('GET', '/v2/dm/x').catch((e) => e);
    expect(err).toBeInstanceOf(YmcsApiError);
    expect(err.status).toBe(502);
    expect(err.body).toBe('<html>gateway</html>');
  });

  it('requires credentials and an endpoint at construction', () => {
    expect(() => new YmcsHttp({ clientId: '', clientSecret: 'x', region: 'us' })).toThrow(/required/);
    expect(() => new YmcsHttp({ clientId: 'a', clientSecret: 'b' })).toThrow(/region or baseUrl/);
  });
});
