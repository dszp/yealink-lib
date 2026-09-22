/**
 * Token caching, as a contract the caller satisfies rather than a store this library owns.
 *
 * Two methods over strings is the smallest declaration of "remember a string for N seconds", so a
 * Worker passes KV, Node passes `memoryCache()`, and a caller who does not want caching passes
 * nothing — the client then keeps the token in instance memory only.
 *
 * What gets stored is the ACCESS TOKEN and its expiry, never the client secret. A YMCS access token
 * is a bearer credential valid for `expires_in` seconds (86 400 in the reference), so the store must
 * be private to the deployment that owns the credential. A shared or world-readable store is not a
 * place for it.
 */
export interface TokenCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * An in-process cache, for Node scripts and tests.
 *
 * ⚠️ NOT for a Worker. Module state in a Worker lives only as long as the isolate, so one instance
 * would have a token and the next would mint another — which works, but defeats the point. Pass a
 * KV-backed `TokenCache` there.
 *
 * `now` is injected so expiry is testable without a timer.
 */
export function memoryCache(now: () => number = () => Date.now()): TokenCache {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const hit = store.get(key);
      if (hit === undefined) return null;
      if (hit.expiresAt <= now()) {
        store.delete(key);
        return null;
      }
      return hit.value;
    },
    async put(key, value, ttlSeconds) {
      store.set(key, { value, expiresAt: now() + ttlSeconds * 1000 });
    },
  };
}
