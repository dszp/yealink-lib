# Changelog

All notable changes to `@dszp/yealink-lib` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-22

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

### Verified live (2026-09-22, read-only, one production enterprise)

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

### Notes

- Extracted from `@dszp/n8n-nodes-yealinkymcs` 0.3.0. Request shapes are the ones that node
  exercised against live YMCS; the offline suite covers every method's wire shape.
- Not yet published. The first publish is manual (npm attaches a trusted publisher only to an
  existing package); releases after that run from a GitHub Release.
