# Architecture

Why this library is shaped the way it is. For the rules of contributing, see
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Module boundaries

| File | Role | Ships? |
|---|---|---|
| `model.ts` | `DeviceType`, `YmcsPage<T>`, `ListOptions`, and the record types (`YmcsSite`, `YmcsDevice`, `YmcsRpsDevice`, …). Hand-written from the V4X reference's examples; each carries an index signature because the reference is example-derived. | ✅ |
| `auth.ts` | `fetchAccessToken` (the client-credentials exchange), `resolveBaseUrl`, `nonce`, `replayHeaders`, `REGION_HOSTS`, `YmcsAuthError`. | ✅ |
| `cache.ts` | `TokenCache` — two methods over strings — and `memoryCache()`. | ✅ |
| `http.ts` | `YmcsHttp` transport + `YmcsApiError`. Owns the token lifecycle. **Not exported.** | ✅ (class private) |
| `paginate.ts` | `listAll` — the skip/limit/autoCount walk — and the per-endpoint page caps. | ✅ |
| `readClient.ts` | `YmcsReadClient` — every GET and every `list*` POST. | ✅ |
| `writeClient.ts` | `YmcsWriteClient` — every mutation, plus `request` / `requestAllItems`. | ✅ |
| `index.ts` | Public barrel — everything except `YmcsHttp` and the package-internal helpers. | ✅ |
| `testkit.ts` | Mock `fetch` speaking YMCS's shapes, including `/v2/token`. **Build-excluded.** | dev |

## One transport, two clients

`YmcsHttp` is the single choke point: it resolves the base URL, mints and refreshes the token,
attaches `Authorization`, `timestamp` and `nonce` to every request, parses the response
defensively, and unwraps YMCS's `{ code, requestId, message, details }` envelope into
`YmcsApiError`.

It is private inside each client and never exported. `YmcsReadClient`'s surface has no mutating
method to call — not "shouldn't", *can't*. `YmcsWriteClient` is the separate class that does.
A runtime test checks both the prototype and an instance for write-shaped names, and a
type-level test pins the same fact.

**Therefore:** never export `YmcsHttp`, never merge the two classes, never add a generic
`request()` to the read client.

## Where the token lives

Three places, in order of consultation:

1. **Instance memory.** Set on first mint; reused until a minute before `expiresAt`.
2. **The injected `TokenCache`**, if any — read before minting, written after. Keyed
   `ymcs:token:<host>:<clientId>`, so two enterprises or two regions in one KV namespace stay apart.
   The secret is never part of a key or a value.
3. **`POST /v2/token`.** Single-flighted: concurrent first requests share one exchange.

On a 401 the transport forgets its token, mints again (which re-reads the cache first — a cache
entry that just produced a 401 is still trusted once, which is the cost of not having a `delete` on
the cache contract), and retries the request once. A second 401 surfaces.

## Why lists return arrays, not pages

Every YMCS list is `POST` + `{ skip, limit, autoCount, filter }`. The reference recommends
`autoCount: true` only on the first page, because counting is the expensive half. `listAll` does
that, drives the loop on the first `total`, and also stops on a short or empty page — so an
endpoint that omits `total`, or a fleet that shrinks mid-walk, terminates.

The read methods return `T[]` rather than the page envelope because no consumer of this library so
far has wanted `skip`/`limit`/`total` — they want the rows, or the first N (`limit`). A raw-page
method can be added without changing the array-returning ones.

## Three API facts that shaped the code

1. **A bodyless POST answers 412, `{}` does not.** So `RequestOptions.body === undefined` sends no
   body and `{}` goes on the wire as `{}`, and every write method with nothing to say sends `{}`.
2. **`listDevices` caps `limit` at 100; the others at 500.** Above the cap the server answers 400
   rather than clamping, so the library clamps per endpoint.
3. **A reused `nonce` is a 403.** Headers are minted per request, inside the transport, never once
   per client.

## Relationship to the n8n node

This library was extracted from `@dszp/n8n-nodes-yealinkymcs`, whose credential and generic
functions held the same auth and paging logic against n8n's request helpers. The node's sixteen
description files (the UI) stay with the node; the request shapes in `writeClient.ts` are the ones
the node exercised live. The node may consume this library in a future release; nothing here
depends on it.
