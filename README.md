# @dszp/yealink-lib

Portable, Node-free toolkit for Yealink's device-management cloud. Runs unchanged in a Cloudflare
Worker, Node, or the browser. Zero runtime dependencies.

Yealink runs two services behind one API, the YMCS Open API V4X, and one set of credentials
reaches both:

- **YMCS** (Yealink Management Cloud Service) manages devices after deployment: sites, devices,
  groups, SIP accounts, configuration templates, firmware, alarms and diagnostics.
- **RPS** (Redirect and Provisioning Service) handles zero-touch deployment: it points a device
  at its provisioning server by MAC address the first time the device boots.

The library covers both, and handles the OAuth2 client-credentials exchange and the per-request
`timestamp`/`nonce` headers for you. Class and type names start with `Ymcs` because that is the
API's name; the RPS methods live on the same clients.

## Install

```bash
pnpm add @dszp/yealink-lib
```

## Use

```ts
import { YmcsReadClient, YmcsWriteClient, DeviceType } from '@dszp/yealink-lib';

// Credentials come from wherever your runtime keeps secrets — a Worker's `env`, a CLI's config
// file, a test's fixture. This library never reads the environment itself.
const read = new YmcsReadClient({
  clientId: env.YMCS_CLIENT_ID,         // AccessKey ID from YMCS → Enterprise Settings → API Service
  clientSecret: env.YMCS_CLIENT_SECRET, // AccessKey Secret
  region: 'us',                         // REQUIRED: 'us' | 'eu' | 'au' — or `baseUrl` for another host
});

const sites = await read.listSites();
const online = await read.listDevices({ filter: { deviceStatus: 1, siteId: sites[0].id } });
const ids = await read.resolveDeviceIds(['001565000001'], DeviceType.Phone);

const write = new YmcsWriteClient({ clientId, clientSecret, region: 'us' });
await write.createRpsDevice({ mac: '001565000001', sn: 'SN000000000001', serverId: 'srv-0001' });
await write.rebootDevices([ids[0].deviceId], DeviceType.Phone);
```

### In a Worker: share the token through KV

The access token lives for a day. Without a cache each isolate mints its own, which works but is
wasteful. Pass any store with `get(key)` and `put(key, value, ttlSeconds)`:

```ts
const read = new YmcsReadClient({
  clientId, clientSecret, region: 'eu',
  tokenCache: {
    get: (k) => env.TOKENS.get(k),
    put: (k, v, ttl) => env.TOKENS.put(k, v, { expirationTtl: ttl }),
  },
});
```

The cache holds the access token only, keyed by host and client id. The secret is never stored.

## What the library does for you

- **Auth.** `POST /v2/token` with Basic credentials, refreshed a minute before expiry. On a 401 it
  refreshes once and retries once; a second 401 surfaces as the error it is. Concurrent first
  requests share one token exchange.
- **Replay headers.** YMCS requires `timestamp` and `nonce` on every request and rejects a reused
  nonce (`403`, code `500403`). Both are minted per call.
- **Pagination.** Every YMCS list is a `POST` with `{ skip, limit, autoCount, filter }`. List
  methods walk every page (counting only on the first) and return one array; pass `limit` to stop
  early. `listDevices` caps pages at 100 where every other list caps at 500 — the library knows.
- **The bodyless-POST trap.** YMCS answers a POST with no body at all with `412` (code `900444`)
  but accepts `{}`. Methods with nothing to send put `{}` on the wire. In `request()`, `body`
  undefined means no body and `{}` means `{}`.
- **Errors.** `YmcsApiError` carries `status`, YMCS's `code`, the `requestId` support asks for, and
  per-field `details`. A proxy's HTML error page still becomes a `YmcsApiError` with its status.
  An unknown id answers **400 with code `900400`**, not 404: test `err.code`, not the status.
- **Bulk results.** Bulk calls (`deleteDevices`, `rebootDevices`, `bindAccounts`, `deleteRpsDevices`
  and the rest) answer HTTP 200 with a `YmcsBulkResult` even when items fail. A MAC that does not
  exist comes back as `failureCount: 1` with a row in `errors`, not as an exception. Check
  `failureCount`.

## Read / write split

`YmcsReadClient` has no method that writes, and it cannot be made to: it keeps its transport in a
JavaScript private field, the transport class is not exported, and the package exports only its
root entry point. A consumer that holds a `YmcsReadClient` cannot write by accident.

`YmcsWriteClient` is the only mutation surface. Its `request()` and `requestAllItems()` reach any
endpoint the library does not name, with the same auth and paging. They sit on the write client
because YMCS lists are POSTs: a passthrough cannot tell a read from a write by its HTTP method.

## Device management and RPS sync

An enterprise can sync device management with RPS. With sync on, observed on one enterprise:

- `createDevice` and `addDevices` also create the device in RPS, with no server assigned. Assign
  one with `updateRpsDevice(id, { serverId })`.
- `deleteDevice` and `deleteDevices` also delete the device from RPS.
- `createRpsDevice` does not create the device in device management. `addRpsDevices` does, in the
  site the enterprise's sync settings choose.

Whether to rely on sync is the caller's decision. The library sends exactly the calls you make.

## Shapes that differ from Yealink's reference

The live API was checked against the V4X reference, and these methods follow the API where the
two disagree:

- `addDevices`, `addRpsDevices` and `bindAccounts` send a bare JSON array. Wrapping it in an object
  answers 412, as if the body were missing.
- `updateSipAccount` takes the whole account, and `updateRpsServer` needs both `serverName` and
  `url`. A partial body answers 400.
- A device has at most one device config, and it cannot be updated: `createDeviceConfig` a second
  time answers 400 code `800003`, and PATCH answers 405. Delete it and create it again.
- RPS servers are deleted in bulk with `deleteRpsServers`. The API has no single-server DELETE.
- `rebootDeviceParts` and `resetDeviceParts` use `/v2/dm/devices/…`. The reference's
  `/v2/dm/device/…` answers 404.

## Two Yealink spellings

The wire paths `listOfficalFirmwares` and `officalFirmwares/{id}/push` are Yealink's; the library
matches them exactly and corrects only the method names (`listOfficialFirmwares`,
`pushOfficialFirmware`).

## License

MIT
