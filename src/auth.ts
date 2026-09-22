/**
 * OAuth2 client-credentials exchange for YMCS, and the two per-request headers the API demands.
 *
 * YMCS is OAuth2 with a twist: every request — including the token request — must carry a
 * `timestamp` header (epoch milliseconds) and a `nonce` header (random, at most 32 characters),
 * and the server rejects a REPLAYED nonce with `403 {"code":"500403","message":"Request reply"}`.
 * So the headers are minted per call, never once per client.
 *
 * Exported separately from the transport so a consumer can warm a shared `TokenCache` ahead of
 * time, or inspect the exchange in isolation. Ordinary consumers never call this: `YmcsReadClient`
 * and `YmcsWriteClient` mint and refresh tokens themselves.
 */

import type { YmcsRegion } from './model.js';

export const REGION_HOSTS: Readonly<Record<YmcsRegion, string>> = {
  us: 'https://us-api.ymcs.yealink.com',
  eu: 'https://eu-api.ymcs.yealink.com',
  au: 'https://au-api.ymcs.yealink.com',
};

/**
 * Where to send requests. One of `region` or `baseUrl` is REQUIRED and there is no default —
 * a library that quietly picks a region binds every consumer to one deployment.
 */
export interface YmcsEndpoint {
  /** One of the public YMCS regions. */
  region?: YmcsRegion;
  /** Any other host (an on-premises YMCS, a proxy). Takes precedence over `region`. */
  baseUrl?: string;
}

export function resolveBaseUrl(endpoint: YmcsEndpoint): string {
  if (endpoint.baseUrl) return endpoint.baseUrl.replace(/\/+$/, '');
  if (endpoint.region) {
    const host = REGION_HOSTS[endpoint.region];
    if (!host) throw new Error(`yealink-lib: unknown region "${endpoint.region}" (expected us | eu | au)`);
    return host;
  }
  throw new Error('yealink-lib: region or baseUrl is required (no default — YMCS is served per region)');
}

/** 32 hex characters, from the platform's CSPRNG. Web Crypto exists in Workers, Node ≥ 19 and browsers. */
export function nonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** The two headers YMCS requires on every request. Fresh values each call — see the module note. */
export function replayHeaders(now: () => number = () => Date.now()): { timestamp: string; nonce: string } {
  return { timestamp: String(now()), nonce: nonce() };
}

export interface TokenRequest extends YmcsEndpoint {
  /** The AccessKey ID from YMCS → Enterprise Settings → API Service. */
  clientId: string;
  /** The AccessKey Secret. */
  clientSecret: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface AccessToken {
  accessToken: string;
  /** Epoch milliseconds, computed from the server's `expires_in` at the moment of issue. */
  expiresAt: number;
}

export class YmcsAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'YmcsAuthError';
  }
}

/**
 * `POST /v2/token` with `Authorization: Basic base64(clientId:clientSecret)`.
 *
 * ⚠️ Neither the secret nor the Basic header is ever placed in an error. The response body is —
 * up to 500 bytes — because it carries YMCS's `code`/`requestId`, which is what support asks for.
 */
export async function fetchAccessToken(req: TokenRequest): Promise<AccessToken> {
  if (!req.clientId || !req.clientSecret) throw new Error('yealink-lib: clientId and clientSecret are required');
  const now = req.now ?? (() => Date.now());
  const doFetch = req.fetchImpl ?? fetch;
  const url = `${resolveBaseUrl(req)}/v2/token`;
  const res = await doFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${req.clientId}:${req.clientSecret}`)}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...replayHeaders(now),
    },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const detail = (typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed)).slice(0, 500);
    throw new YmcsAuthError(`POST /v2/token → ${res.status}: ${detail}`, res.status, parsed);
  }
  const body = (parsed ?? {}) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new YmcsAuthError('POST /v2/token answered 200 without an access_token', res.status, parsed);
  }
  const ttl = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 0;
  return { accessToken: body.access_token, expiresAt: now() + ttl * 1000 };
}
