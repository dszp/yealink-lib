/**
 * YmcsHttp — the single transport for the YMCS API, and the choke point every call flows through.
 * Node-free: Web `fetch`/`Response` only.
 *
 * READ/WRITE BOUNDARY: this class is deliberately NOT exported from the public barrel.
 * `YmcsReadClient` holds one privately and exposes only reads; `YmcsWriteClient` is the only
 * sanctioned mutation surface. Exporting the transport would let a consumer bypass that in one line.
 *
 * Token lifecycle lives here, not in the clients: mint on first use, keep in memory (and in the
 * optional `TokenCache`), refresh before expiry, and on a 401 refresh once and retry once.
 */

import { fetchAccessToken, replayHeaders, resolveBaseUrl, type AccessToken, type YmcsEndpoint } from './auth.js';
import type { TokenCache } from './cache.js';

export interface YmcsConfig extends YmcsEndpoint {
  /** The AccessKey ID from YMCS → Enterprise Settings → API Service. */
  clientId: string;
  /** The AccessKey Secret. Never leaves this process: it is used only to mint tokens. */
  clientSecret: string;
  /**
   * Optional. Where to keep the access token between instances — a Worker passes KV. Without it
   * the token lives in this instance only, and each new instance mints its own.
   */
  tokenCache?: TokenCache;
  /** Injectable for tests / non-global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/** One `{ field, message }` per invalid input, when YMCS answers a validation error. */
export interface YmcsErrorDetail {
  field: string;
  message: string;
}

/**
 * YMCS's error envelope is `{ code, requestId, message, details? }`. `code` is the server-defined
 * string (e.g. `900444` for a bodyless POST, `500403` for a replayed nonce) and `requestId` is what
 * Yealink support asks for.
 */
export class YmcsApiError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly details?: YmcsErrorDetail[];
  constructor(
    message: string,
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'YmcsApiError';
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.code === 'string' || typeof b.code === 'number') this.code = String(b.code);
    if (typeof b.requestId === 'string') this.requestId = b.requestId;
    if (Array.isArray(b.details)) this.details = b.details as YmcsErrorDetail[];
  }
}

function describe(status: number, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof b.message === 'string') parts.push(b.message);
  if (b.code !== undefined) parts.push(`code ${String(b.code)}`);
  if (Array.isArray(b.details)) {
    const d = (b.details as YmcsErrorDetail[]).map((x) => `${x.field}: ${x.message}`).join('; ');
    if (d) parts.push(d);
  }
  if (parts.length) return parts.join(' — ');
  // Note for readers of the message: YMCS answers an UNKNOWN id with 400 code 900400 ("This resource
  // does not exist or has been deleted"), never 404. Test `err.code`, not `err.status === 404`.
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  if (status === 412) return `precondition failed (a POST with no body at all answers this — send {} instead)${raw ? `: ${raw.slice(0, 200)}` : ''}`;
  return (raw ?? '').slice(0, 500);
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * `undefined` sends NO body. `{}` sends the literal `{}`. They are not the same thing to YMCS: a
   * bodyless POST answers 412 (code 900444), while `{}` is accepted and the server applies defaults.
   */
  body?: unknown;
}

/** Skew before `expiresAt` at which a token is treated as expired, so a request never races the edge. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

export class YmcsHttp {
  readonly #base: string;
  readonly #cfg: YmcsConfig;
  readonly #fetchImpl: typeof fetch;
  readonly #now: () => number;
  readonly #cacheKey: string;
  #token: AccessToken | undefined;
  #minting: Promise<AccessToken> | undefined;

  constructor(cfg: YmcsConfig) {
    if (!cfg?.clientId || !cfg.clientSecret) throw new Error('yealink-lib: clientId and clientSecret are required');
    this.#base = resolveBaseUrl(cfg);
    this.#cfg = cfg;
    this.#fetchImpl = cfg.fetchImpl ?? fetch;
    this.#now = cfg.now ?? (() => Date.now());
    // Host + client id keeps two enterprises, or two regions, apart in one shared store. The secret
    // is never part of a key: keys get listed and logged.
    this.#cacheKey = `ymcs:token:${new URL(this.#base).host}:${cfg.clientId}`;
  }

  get baseUrl(): string {
    return this.#base;
  }

  async #token_(): Promise<string> {
    const t = this.#token;
    if (t && t.expiresAt - TOKEN_REFRESH_SKEW_MS > this.#now()) return t.accessToken;
    return (await this.#mint()).accessToken;
  }

  /** Single-flight: concurrent first requests share one token exchange instead of each minting. */
  #mint(): Promise<AccessToken> {
    if (this.#minting) return this.#minting;
    this.#minting = (async () => {
      try {
        const cached = await this.#readCache();
        if (cached) {
          this.#token = cached;
          return cached;
        }
        const fresh = await fetchAccessToken({
          clientId: this.#cfg.clientId,
          clientSecret: this.#cfg.clientSecret,
          baseUrl: this.#base,
          fetchImpl: this.#fetchImpl,
          now: this.#now,
        });
        this.#token = fresh;
        await this.#writeCache(fresh);
        return fresh;
      } finally {
        this.#minting = undefined;
      }
    })();
    return this.#minting;
  }

  async #readCache(): Promise<AccessToken | undefined> {
    const cache = this.#cfg.tokenCache;
    if (!cache) return undefined;
    const raw = await cache.get(this.#cacheKey);
    if (!raw) return undefined;
    try {
      const v = JSON.parse(raw) as Partial<AccessToken>;
      if (typeof v.accessToken === 'string' && typeof v.expiresAt === 'number' && v.expiresAt - TOKEN_REFRESH_SKEW_MS > this.#now()) {
        return { accessToken: v.accessToken, expiresAt: v.expiresAt };
      }
    } catch {
      /* a corrupt entry is the same as no entry */
    }
    return undefined;
  }

  async #writeCache(t: AccessToken): Promise<void> {
    const cache = this.#cfg.tokenCache;
    if (!cache) return;
    // KV's minimum TTL is 60 s; a token with less life than that is not worth storing.
    const ttl = Math.floor((t.expiresAt - this.#now()) / 1000) - TOKEN_REFRESH_SKEW_MS / 1000;
    if (ttl < 60) return;
    await cache.put(this.#cacheKey, JSON.stringify(t), ttl);
  }

  /** Drop the in-memory token so the next call mints (or re-reads the cache). Used after a 401. */
  #forget(): void {
    this.#token = undefined;
  }

  async request<T = unknown>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const p = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(`${this.#base}${p}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const send = async (token: string): Promise<Response> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...replayHeaders(this.#now),
      };
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      // Call via a local, NOT `this.#fetchImpl(...)`: invoking the global fetch as a method of this
      // instance throws "Illegal invocation" in workerd.
      const doFetch = this.#fetchImpl;
      return doFetch(url.toString(), {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    };

    let res = await send(await this.#token_());
    if (res.status === 401) {
      // The token may have been revoked upstream, or a cached one may be stale. One refresh, one
      // retry; a second 401 is a real answer and surfaces as the error it is.
      this.#forget();
      const fresh = await this.#mint();
      res = await send(fresh.accessToken);
    }

    // Guard the parse: a proxy 502 (HTML body) must surface as a YmcsApiError carrying the status,
    // never a raw SyntaxError that hides it.
    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave `parsed` as the raw text */
      }
    }

    if (!res.ok) {
      throw new YmcsApiError(`${method} ${p} → ${res.status}: ${describe(res.status, parsed)}`, res.status, method, p, parsed);
    }
    // Updates and deletes answer 204 with no body; normalize so callers never see '' for an object.
    if (text === '') return {} as T;
    return parsed as T;
  }
}
