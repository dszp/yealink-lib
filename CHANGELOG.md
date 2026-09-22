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

### Notes

- Extracted from `@dszp/n8n-nodes-yealinkymcs` 0.3.0. Request shapes are the ones that node
  exercised against live YMCS; the offline suite covers every method's wire shape.
- Not yet published. The first publish is manual (npm attaches a trusted publisher only to an
  existing package); releases after that run from a GitHub Release.
