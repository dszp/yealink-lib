# Changelog

All notable changes to `@dszp/yealink-lib` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-09-25

### Changed

- Documented that `resolveDeviceIds` does not return results in request order; callers must
  correlate on each entry's `key`. The README example now does so. Doc-only change.

## [0.1.1] — 2026-09-23

### Changed

- First release published from a GitHub Release through npm trusted publishing (OIDC), with a
  provenance attestation. No code changes from 0.1.0.

## [0.1.0] — 2026-09-23

### Added

- **`YmcsReadClient`** — sites, devices (list capped at 100 per page, as the API requires),
  MAC → id resolution, accessories, bound accounts, network interfaces, device groups, SIP accounts,
  configuration templates (device / site / group), custom and official firmware, models, alarms,
  operation logs, diagnosis status, RPS devices and servers.
- **`YmcsWriteClient`** — the corresponding creates, updates, deletes and pushes; reboot / factory
  reset; account binding; diagnostics (packet capture, screenshot, syslog and config export, ping,
  traceroute); RPS device and server management. Plus `request()` and `requestAllItems()` for
  endpoints the library does not name.
- **`fetchAccessToken`** and the `TokenCache` contract — OAuth2 client-credentials exchange with
  the `timestamp`/`nonce` headers, refreshed before expiry and once more on a 401; optional shared
  store (Workers KV, a Map) keyed by host and client id.
- **`YmcsApiError`** carrying `status`, `code`, `requestId` and per-field `details`.
- No default region: `region` or `baseUrl` is required.

### Verified live: reads (2026-09-22, one production enterprise)

- Auth, sites, devices (250-row walk at the 100 cap), models, device lookup by MAC, firmware,
  alarms, operation logs, RPS servers and devices, configuration templates.
- `listOfficalFirmwares` answers 400 when `filter` is absent, and again when `filter.modelId` is
  empty. Every list now sends `filter: {}` by default, and `listOfficialFirmwares(modelId)` takes
  the model id positionally.
- `boundAccounts` is phone-only: a room device answers 400 code `800005`. The `{ data }`
  envelope is unwrapped to `YmcsBoundAccount[]`.
- `getDeviceConfigs` answers `{ deviceConfig, siteConfig, globalConfig, enforceConfig }`.
- An unknown id answers **400 with code `900400`**, not 404. Check `YmcsApiError.code`.
- `GET /v2/dm/devices/{id}` returns more than the list row does (`accounts`, `wifi`, `sensor`,
  `personCount`, `lanIp`/`wanIp`); the list row carries `modelName`, `siteName`, `groupNames`,
  `lastReportTime`. Neither is in the reference's example.

### Verified live: writes (2026-09-23, same enterprise, one bench phone)

Every write method except `addDevicesByMac` (the enterprise is not enabled for it) and
`startPacketCapture` (the server rejects a `duration` of 60 and does not document the values it
accepts). Ten methods, carried over from the n8n node, sent requests the API rejected; they now
send what the API accepts:

- `addDevices`, `addRpsDevices` and `bindAccounts` send a bare array; an object answers 412.
- `CreateSipAccountInput` takes `sipServer1: { host, port }`, and `updateSipAccount` takes the
  whole account, because a partial body answers 400.
- `DeviceConfigInput` is `{ deviceId, content, autoPush? }`, one per device. `updateDeviceConfig`
  is removed: the API answers PATCH with 405.
- `updateRpsServer` requires `serverName` and `url`. `deleteRpsServer` is replaced by
  `deleteRpsServers(ids)` (`POST /v2/rps/delServers`); the API has no single-server DELETE.
- `deleteRpsDevices(deviceIds, deviceIdType)` posts to `/v2/rps/delDevices` with
  `{ deviceIdType, deviceIds }`, and returns the bulk result.

Also added: `YmcsBulkResult` and `YmcsCreated` as return types, `SipServer` and `BindAccount` as
input types, `YmcsReadClient.getRpsServer`, and `src/live.test.ts`, an opt-in live suite in three
tiers (reads, throwaway objects, a named bench phone).

### Notes

- Extracted from `@dszp/n8n-nodes-yealinkymcs` 0.3.0. The offline suite covers every method's wire
  shape; `src/live.test.ts` covers the live API when credentials are set.
- Published by hand: npm attaches a trusted publisher only to a package that already exists.
  Releases after this one run from a GitHub Release.
