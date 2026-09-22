# Contributing to `@dszp/yealink-lib`

Bug reports, ideas, and pull requests are welcome. This library is small and opinionated; the rules
below are the opinions, and they exist for concrete reasons rather than taste.

## Getting started

**Package manager: pnpm.** No runtime dependencies — please keep it that way.

```
pnpm install
pnpm build         # tsc → dist/
pnpm test          # vitest — must pass with NO credentials and no setup
pnpm typecheck     # tsc -p tsconfig.test.json --noEmit
```

Run `pnpm test && pnpm typecheck && pnpm build` before pushing — all three clean. `pnpm test` must
be green on a fresh clone with no environment variables set: every test runs against the mock
transport in `src/testkit.ts`, never a live enterprise.

## The rules

### 1. Fixtures and examples must be fictional

Every enterprise, site, device, MAC, serial, host, and identifier in this repo — in code, comments,
tests, and the README — must be invented. No exceptions, including "just for a moment while I debug."

| Use | Prefer |
|---|---|
| hosts / SIP servers / RPS URLs | `example.com`, `example.net`, `*.example` |
| MAC addresses | `001565` + an obviously sequential tail (`001565000001`) |
| serial numbers | `SN000000000001`-style |
| YMCS ids | `site-0001`, `dev-0001`, `srv-0001` (the real ones are 32 hex chars; fixtures do not need to be) |
| credentials | `ak-test-0001` / `not-a-real-secret` |

### 2. No real customer data, ever

Not in code, comments, tests, the README, **or a commit message**. If you pull a sample from a live
enterprise while debugging, rewrite it to the fictional forms above before it touches a tracked
file. To reproduce a bug, describe the *shape* (`a device whose siteId is null`), not the value.

### 3. Doc comments are published API

They ship in `dist/*.d.ts` and surface on IDE hover for every consumer. Several doc comments in
`src/` exist specifically to carry a live-verified API fact forward — the 412-on-bodyless-POST
trap, the 100-row cap on `listDevices`, the nonce replay rejection, the misspelled firmware paths.
Preserve them when you touch a method.

### 4. The read/write split is a charter, not a style preference

`YmcsReadClient` exposes no mutating methods. New write capability extends `YmcsWriteClient` (or a
sibling write class), **never** the read client — and the read client gets no generic `request()`
either. A runtime test (`readClient.test.ts`) asserts no write-shaped method name exists on the
prototype **or** an instance (an arrow-function class field lands on the instance and would evade
a prototype-only check). Declare methods with plain `method() {}` syntax.

### 5. `YmcsHttp` is never exported

It is the one transport both clients share, and it is absent from `index.ts` on purpose. Export
types from `http.ts` (`YmcsConfig`, `YmcsApiError`) — never the class.

### 6. No default region

YMCS is served per region (`us`, `eu`, `au`) and can be self-hosted. `resolveBaseUrl` throws when
neither `region` nor `baseUrl` is given rather than guessing. Don't add a default to make an
example shorter; make the example pass `region`.

### 7. No defaults that bind the library to one deployment

Apply the same test to anything else you're tempted to default: does the value encode *someone's*
enterprise, site tree, or RPS server rather than a fact true of YMCS for every consumer? Then it's
a bug, not a convenience.

### 8. Keep it Node-free

Never import `node:*` anywhere in `src/`, except `*.test.ts` files, which are excluded from the
build. Use Web APIs — `fetch`, `crypto.randomUUID`, `btoa`, `URL`. This is enforced structurally:
`tsconfig.json` omits `@types/node`, so a stray `node:*` import fails `pnpm build`. That failure is
the feature.

### 9. Request shapes come from the wire, not the PDF

Yealink's reference is example-derived and has no machine-readable form. Every method here mirrors
a request shape that was exercised against a live enterprise (via the `@dszp/n8n-nodes-yealinkymcs`
node this library was extracted from). A new method should say in its doc comment what it was
verified against, or be marked as unverified.

## Pull requests

- One logical change per PR; include a test.
- Run `pnpm test && pnpm typecheck && pnpm build` before opening.
- Add a `CHANGELOG.md` entry under "Unreleased" for anything user-visible.
