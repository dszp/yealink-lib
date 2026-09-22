import { describe, expect, it } from 'vitest';
import { fetchAccessToken, nonce, replayHeaders, resolveBaseUrl, YmcsAuthError } from './auth.js';
import { CREDS, mockFetch } from './testkit.js';

describe('resolveBaseUrl', () => {
  it('maps each region to its host', () => {
    expect(resolveBaseUrl({ region: 'us' })).toBe('https://us-api.ymcs.yealink.com');
    expect(resolveBaseUrl({ region: 'eu' })).toBe('https://eu-api.ymcs.yealink.com');
    expect(resolveBaseUrl({ region: 'au' })).toBe('https://au-api.ymcs.yealink.com');
  });
  it('prefers baseUrl over region and strips a trailing slash', () => {
    expect(resolveBaseUrl({ region: 'us', baseUrl: 'https://ymcs.example.com/' })).toBe('https://ymcs.example.com');
  });
  it('has no default region', () => {
    expect(() => resolveBaseUrl({})).toThrow(/region or baseUrl is required/);
    expect(() => resolveBaseUrl({ region: 'mars' as never })).toThrow(/unknown region/);
  });
});

describe('replay headers', () => {
  it('nonce is 32 hex chars and differs per call', () => {
    const a = nonce();
    const b = nonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
  it('timestamp comes from the injected clock', () => {
    expect(replayHeaders(() => 1_700_000_000_000).timestamp).toBe('1700000000000');
  });
});

describe('fetchAccessToken', () => {
  it('sends Basic auth, the replay headers, and the client_credentials grant', async () => {
    const mock = mockFetch();
    const t = await fetchAccessToken({ ...CREDS, fetchImpl: mock.fetchImpl, now: () => 1_000_000 });
    expect(mock.calls).toHaveLength(1);
    const c = mock.calls[0];
    expect(c.method).toBe('POST');
    expect(c.url).toBe('https://us-api.ymcs.yealink.com/v2/token');
    expect(c.headers.Authorization).toBe(`Basic ${btoa('ak-test-0001:not-a-real-secret')}`);
    expect(c.headers.timestamp).toBe('1000000');
    expect(c.headers.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(c.body).toEqual({ grant_type: 'client_credentials' });
    expect(t.accessToken).toBe('test-access-token');
    expect(t.expiresAt).toBe(1_000_000 + 86400 * 1000);
  });

  it('refuses missing credentials before any request', async () => {
    const mock = mockFetch();
    await expect(fetchAccessToken({ clientId: '', clientSecret: 'x', region: 'us', fetchImpl: mock.fetchImpl })).rejects.toThrow(/required/);
    expect(mock.calls).toHaveLength(0);
  });

  it('surfaces a 401 as YmcsAuthError with the envelope, never the secret', async () => {
    const mock = mockFetch({ token: { status: 401, body: { error: 'invalid_client', code: '70012', requestId: 'r1', message: 'bad' } } });
    const err: any = await fetchAccessToken({ ...CREDS, fetchImpl: mock.fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(YmcsAuthError);
    expect(err.status).toBe(401);
    expect(err.message).toContain('70012');
    expect(err.message).not.toContain('not-a-real-secret');
    expect(err.message).not.toContain(btoa('ak-test-0001:not-a-real-secret'));
  });

  it('treats a 200 with no access_token as failure', async () => {
    const mock = mockFetch({ token: { body: { token_type: 'bearer' } } });
    await expect(fetchAccessToken({ ...CREDS, fetchImpl: mock.fetchImpl })).rejects.toThrow(/without an access_token/);
  });

  it('a non-JSON error body still carries the status', async () => {
    const mock = mockFetch({ token: { status: 502, rawBody: '<html>bad gateway</html>' } });
    const err: any = await fetchAccessToken({ ...CREDS, fetchImpl: mock.fetchImpl }).catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.message).toContain('bad gateway');
  });
});
