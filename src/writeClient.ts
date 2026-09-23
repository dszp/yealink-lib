/**
 * YmcsWriteClient — the only sanctioned mutation surface. A separate class over the same private
 * transport, so a consumer that holds only a `YmcsReadClient` cannot reach any of this.
 *
 * Request shapes follow the V4X reference where it agrees with the live API, and the live API where
 * it does not; every method here was exercised against a production enterprise. Facts that shaped
 * them:
 *
 *   - Updates (PATCH) and single deletes (DELETE) answer 204 with no body, so those methods return
 *     `void`. Creates return the new record (config templates return only `{ id }`).
 *   - Bulk calls answer 200 with a `YmcsBulkResult` even when items fail. Check `failureCount`.
 *   - A POST with no body at all answers 412 (code 900444), while `{}` is accepted. Methods that
 *     take no parameters therefore send `{}` explicitly. The bulk adds and `bindAccounts` take a
 *     bare JSON array; wrapping it in an object also answers 412, as if the body were missing.
 *   - Some PATCHes replace rather than merge: a SIP account needs its four required fields on
 *     every update, and an RPS server needs `serverName` and `url`.
 *
 * `request()` / `requestAllItems()` are the escape hatch for endpoints this library does not name.
 * They live HERE and not on the read client on purpose: holding a write client already means you
 * can write, so a passthrough adds no new capability.
 */

import { YmcsHttp, type YmcsConfig, type RequestOptions } from './http.js';
import { listEndpoint, segment } from './readClient.js';
import type {
  DiagnosisStarted,
  ListOptions,
  Rec,
  YmcsBulkResult,
  YmcsCreated,
  YmcsDevice,
  YmcsDeviceGroup,
  YmcsRpsDevice,
  YmcsRpsServer,
  YmcsSipAccount,
  YmcsSite,
} from './model.js';

/** `POST /v2/dm/devices` body. `deviceType` must be 1 or 3 — never 0 — for a create. */
export interface CreateDeviceInput extends Rec {
  mac: string;
  sn: string;
  deviceType: 1 | 3;
  modelId: string;
  name?: string;
  siteId?: string;
}

export interface CreateSiteInput extends Rec {
  name: string;
  /** The parent site's id. Required by the API; the enterprise root is a site too. */
  parentId: string;
  description?: string;
}

export interface SipServer {
  host: string;
  /** 0–65535. */
  port: number;
}

/** `POST /v2/dm/sipAccounts` body, and the full body `updateSipAccount` needs. */
export interface CreateSipAccountInput extends Rec {
  registerName: string;
  username: string;
  password: string;
  sipServer1: SipServer;
  sipServer2?: SipServer;
  displayName?: string;
  label?: string;
  siteId?: string;
  remark?: string;
}

/** One line-key binding for `bindAccounts`. `accountType`: 0 SIP, 1 H.323, 2 SfB. */
export interface BindAccount {
  accountId: string;
  /** 1-based line key. */
  lineId?: number;
  accountType?: 0 | 1 | 2;
}

/**
 * `POST /v2/rps/devices`. `sn` is required unless Yealink support has enabled blank-serial
 * registration on the enterprise — this library does not enforce either way; the server does.
 */
export interface CreateRpsDeviceInput extends Rec {
  mac: string;
  sn?: string;
  serverId?: string;
  authName?: string;
  password?: string;
  remark?: string;
  uniqueServerUrl?: string;
}

export interface CreateRpsServerInput extends Rec {
  serverName: string;
  url: string;
  authName?: string;
  password?: string;
  certificateUrl?: string;
  serverCertificateEnable?: boolean;
  serverCertificateEnableWithSHA256?: boolean;
  serverCertificateUrl?: string;
}

/**
 * `POST /v2/dm/deviceConfigs` body. A device has at most one device config: the server names it
 * after the MAC, and a second create for the same device answers 400 code `800003`.
 */
export interface DeviceConfigInput extends Rec {
  deviceId: string;
  /** Provisioning-file lines, e.g. `lang.wui=English`. The server prepends `#!version:1.0.0.1`. */
  content: string;
  /** Push automatically when the device first boots or is factory reset. */
  autoPush?: boolean;
}

export interface SiteConfigInput extends Rec {
  name: string;
  siteId: string;
  deviceType: 1 | 3;
  /** Omit to apply to every model. */
  modelId?: string;
  content?: string;
}

export interface GroupConfigInput extends Rec {
  name: string;
  deviceGroupId: string;
  deviceType: 1 | 3;
  /** Omit to apply to every model. */
  modelId?: string;
  content?: string;
}

/** `request()` accepts any verb the API uses. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function nonEmpty(name: string, patch: Rec): Rec {
  if (Object.keys(patch).length === 0) throw new Error(`yealink-lib: ${name} needs at least one field to update`);
  return patch;
}

export class YmcsWriteClient {
  readonly #http: YmcsHttp;

  constructor(cfg: YmcsConfig) {
    this.#http = new YmcsHttp(cfg);
  }

  get baseUrl(): string {
    return this.#http.baseUrl;
  }

  #post<T = Rec>(path: string, body: unknown = {}): Promise<T> {
    return this.#http.request<T>('POST', path, { body });
  }

  async #patch(path: string, body: Rec): Promise<void> {
    await this.#http.request('PATCH', path, { body });
  }

  async #delete(path: string): Promise<void> {
    await this.#http.request('DELETE', path);
  }

  #put<T = Rec>(path: string, body: unknown = {}): Promise<T> {
    return this.#http.request<T>('PUT', path, { body });
  }

  // ── Passthrough ────────────────────────────────────────────────────────────────

  /**
   * Any endpoint, authenticated. `body` undefined sends no body; `{}` sends `{}` — see the class
   * note for why that distinction matters to YMCS.
   */
  request<T = unknown>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    return this.#http.request<T>(method, path, opts);
  }

  /**
   * Walk any `POST` list endpoint with the standard skip/limit/autoCount pattern. `dataKey` names
   * the array in the response (default `data`); `maxPageSize` is the endpoint's server cap.
   */
  requestAllItems<T = Rec>(path: string, opts: ListOptions<Rec> & { maxPageSize?: number; dataKey?: string } = {}): Promise<T[]> {
    return listEndpoint<T>(this.#http, path, opts);
  }

  // ── Sites ──────────────────────────────────────────────────────────────────────

  async createSite(input: CreateSiteInput): Promise<YmcsSite> {
    return this.#post('/v2/dm/sites', input);
  }

  /** Fields: `name`, `parentId`, `description`. At least one. */
  async updateSite(siteId: string, patch: { name?: string; parentId?: string; description?: string } & Rec): Promise<void> {
    return this.#patch(`/v2/dm/sites/${segment('siteId', siteId)}`, nonEmpty('updateSite', patch));
  }

  async deleteSite(siteId: string): Promise<void> {
    return this.#delete(`/v2/dm/sites/${segment('siteId', siteId)}`);
  }

  // ── Devices ────────────────────────────────────────────────────────────────────

  /** With enterprise sync on, this also creates the device in RPS, with no server assigned. */
  async createDevice(input: CreateDeviceInput): Promise<YmcsDevice> {
    return this.#post('/v2/dm/devices', input);
  }

  /** Bulk add with MAC + serial (`POST /v2/dm/addDevices`). Sent as a bare array. */
  async addDevices(devices: CreateDeviceInput[]): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/addDevices', devices);
  }

  /**
   * Bulk add by MAC only (`POST /v2/dm/addDevicesByMac`); the enterprise must be enabled for it.
   * Sent as a bare array, like `addDevices`. Not live-verified: the test enterprise is not enabled.
   */
  async addDevicesByMac(devices: Array<{ mac: string; deviceType: 1 | 3; modelId: string; name?: string } & Rec>): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/addDevicesByMac', devices);
  }

  /** Fields: `name`, `siteId` (move). At least one. */
  async updateDevice(deviceId: string, patch: { name?: string; siteId?: string } & Rec): Promise<void> {
    return this.#patch(`/v2/dm/devices/${segment('deviceId', deviceId)}`, nonEmpty('updateDevice', patch));
  }

  /** With enterprise sync on, this also deletes the device from RPS. */
  async deleteDevice(deviceId: string): Promise<void> {
    return this.#delete(`/v2/dm/devices/${segment('deviceId', deviceId)}`);
  }

  /** Bulk delete. `deviceIds` are YMCS ids, or MACs when `deviceIdType: 'mac'`. Sync applies as for `deleteDevice`. */
  async deleteDevices(deviceIds: string[], deviceType: 1 | 3, extra: { deviceIdType?: 'id' | 'mac' } & Rec = {}): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/delDevices', { deviceIds, deviceType, ...extra });
  }

  /** An offline device still counts as a success: the command waits for it to connect. */
  async rebootDevices(deviceIds: string[], deviceType: 1 | 3): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/device/reboot', { deviceIds, deviceType });
  }

  /** Factory reset. Irreversible on the handset; the device re-provisions from RPS afterwards. */
  async resetDevices(deviceIds: string[], deviceType: 1 | 3): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/device/reset', { deviceIds, deviceType });
  }

  /**
   * Reboot accessories. An empty `partIds` reboots every part on the device. The path is
   * `/v2/dm/devices/...`; the reference's `/v2/dm/device/...` answers 404.
   */
  async rebootDeviceParts(deviceId: string, partIds: string[] = []): Promise<YmcsBulkResult> {
    return this.#post(`/v2/dm/devices/${segment('deviceId', deviceId)}/parts/reboot`, partIds.length ? { partIds } : {});
  }

  async resetDeviceParts(deviceId: string, partIds: string[] = []): Promise<YmcsBulkResult> {
    return this.#post(`/v2/dm/devices/${segment('deviceId', deviceId)}/parts/reset`, partIds.length ? { partIds } : {});
  }

  /** Bind accounts to line keys. Phones only. Sent as a bare array. */
  async bindAccounts(deviceId: string, accounts: BindAccount[]): Promise<YmcsBulkResult> {
    return this.#post(`/v2/dm/devices/${segment('deviceId', deviceId)}/bindAccounts`, accounts);
  }

  async unbindAccounts(deviceId: string, accountIds: string[]): Promise<YmcsBulkResult> {
    return this.#post(`/v2/dm/devices/${segment('deviceId', deviceId)}/unbindAccounts`, { accountIds });
  }

  // ── Device groups ──────────────────────────────────────────────────────────────

  /** The API's body field is `name` (the n8n node calls it Group Name). */
  async createDeviceGroup(input: { name: string; deviceType: 1 | 3; description?: string } & Rec): Promise<YmcsDeviceGroup> {
    return this.#post('/v2/dm/deviceGroups', input);
  }

  /** `name` and `deviceType` are both REQUIRED by the API on update, not just the changed field. */
  async updateDeviceGroup(deviceGroupId: string, input: { name: string; deviceType: 1 | 3; description?: string } & Rec): Promise<void> {
    return this.#patch(`/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}`, input);
  }

  async deleteDeviceGroup(deviceGroupId: string): Promise<void> {
    return this.#delete(`/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}`);
  }

  async addDevicesToGroup(deviceGroupId: string, deviceIds: string[]): Promise<YmcsBulkResult> {
    return this.#post(`/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}/addDevices`, { deviceIds });
  }

  async removeDevicesFromGroup(deviceGroupId: string, deviceIds: string[]): Promise<YmcsBulkResult> {
    return this.#post(`/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}/delDevices`, { deviceIds });
  }

  // ── SIP accounts ───────────────────────────────────────────────────────────────

  async createSipAccount(input: CreateSipAccountInput): Promise<YmcsSipAccount> {
    return this.#post('/v2/dm/sipAccounts', input);
  }

  /**
   * Despite being a PATCH, this takes the whole account: `registerName`, `username`, `password`
   * and `sipServer1` are required on every call, and a partial body answers 400.
   */
  async updateSipAccount(accountId: string, input: CreateSipAccountInput): Promise<void> {
    return this.#patch(`/v2/dm/sipAccounts/${segment('accountId', accountId)}`, input);
  }

  /** Bulk delete, maximum 200 ids per call (server limit). */
  async deleteSipAccounts(accountIds: string[]): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/delAccounts', { accountIds });
  }

  // ── Configuration templates ────────────────────────────────────────────────────

  /**
   * There is no update: the API answers PATCH with 405. To change a device config, delete it and
   * create it again.
   */
  async createDeviceConfig(input: DeviceConfigInput): Promise<YmcsCreated> {
    return this.#post('/v2/dm/deviceConfigs', input);
  }

  async deleteDeviceConfigs(configIds: string[]): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/delDeviceConfigs', { configIds });
  }

  async pushDeviceConfig(configId: string): Promise<Rec> {
    return this.#post(`/v2/dm/deviceConfigs/${segment('configId', configId)}/push`);
  }

  async createSiteConfig(input: SiteConfigInput): Promise<YmcsCreated> {
    return this.#post('/v2/dm/siteConfigs', input);
  }

  async updateSiteConfig(configId: string, input: SiteConfigInput): Promise<void> {
    return this.#patch(`/v2/dm/siteConfigs/${segment('configId', configId)}`, input);
  }

  async deleteSiteConfigs(configIds: string[]): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/delSiteConfigs', { configIds });
  }

  async pushSiteConfig(configId: string): Promise<Rec> {
    return this.#post(`/v2/dm/siteConfigs/${segment('configId', configId)}/push`);
  }

  async createGroupConfig(input: GroupConfigInput): Promise<YmcsCreated> {
    return this.#post('/v2/dm/groupConfigs', input);
  }

  async updateGroupConfig(configId: string, input: GroupConfigInput): Promise<void> {
    return this.#patch(`/v2/dm/groupConfigs/${segment('configId', configId)}`, input);
  }

  /** The reference documents DELETE with a body; POST is what the API accepts. */
  async deleteGroupConfigs(configIds: string[]): Promise<YmcsBulkResult> {
    return this.#post('/v2/dm/delGroupConfigs', { configIds });
  }

  async pushGroupConfig(configId: string): Promise<Rec> {
    return this.#post(`/v2/dm/groupConfigs/${segment('configId', configId)}/push`);
  }

  // ── Firmware ───────────────────────────────────────────────────────────────────

  async pushFirmware(firmwareId: string, deviceIds: string[], deviceType: 1 | 3): Promise<YmcsBulkResult> {
    return this.#post(`/v2/dm/firmwares/${segment('firmwareId', firmwareId)}/push`, { deviceIds, deviceType });
  }

  /** Wire path is `officalFirmwares` — Yealink's spelling, matched exactly. */
  async pushOfficialFirmware(officialFirmwareId: string, deviceIds: string[], deviceType: 1 | 3): Promise<YmcsBulkResult> {
    return this.#post(`/v2/dm/officalFirmwares/${segment('officialFirmwareId', officialFirmwareId)}/push`, { deviceIds, deviceType });
  }

  // ── Diagnosis (all answer a diagnosisId to poll with the read client) ─────────

  /**
   * Options per the reference: `networkInterface` (`'wan'`), `type`, `duration` in seconds. The
   * server validates `duration` against values it does not document: 60 answers 400 code
   * `800007`; the reference's example uses 180.
   */
  async startPacketCapture(deviceId: string, opts: Rec = {}): Promise<DiagnosisStarted> {
    return this.#put(`/v2/dm/devices/${segment('deviceId', deviceId)}/startPacketCapture`, opts);
  }

  async stopPacketCapture(deviceId: string, diagnosisId: string): Promise<DiagnosisStarted> {
    return this.#put(`/v2/dm/devices/${segment('deviceId', deviceId)}/stopPacketCapture`, { diagnosisId });
  }

  async captureScreen(deviceId: string): Promise<DiagnosisStarted> {
    return this.#put(`/v2/dm/devices/${segment('deviceId', deviceId)}/captureScreen`);
  }

  async exportSyslog(deviceId: string): Promise<DiagnosisStarted> {
    return this.#put(`/v2/dm/devices/${segment('deviceId', deviceId)}/exportSyslog`);
  }

  async exportConfig(deviceId: string): Promise<DiagnosisStarted> {
    return this.#put(`/v2/dm/devices/${segment('deviceId', deviceId)}/exportConfig`);
  }

  async ping(deviceId: string, host: string, opts: Rec = {}): Promise<DiagnosisStarted> {
    return this.#put(`/v2/dm/devices/${segment('deviceId', deviceId)}/ping`, { host, ...opts });
  }

  async traceroute(deviceId: string, host: string, opts: Rec = {}): Promise<DiagnosisStarted> {
    return this.#put(`/v2/dm/devices/${segment('deviceId', deviceId)}/traceroute`, { host, ...opts });
  }

  // ── RPS ────────────────────────────────────────────────────────────────────────
  // With enterprise sync on, device-management creates and deletes reach RPS (see createDevice).
  // The reverse is partial: a single RPS create stays in RPS, while `addRpsDevices` was seen to
  // create the device in device management too, in a site the enterprise's sync settings chose.

  async createRpsDevice(input: CreateRpsDeviceInput): Promise<YmcsRpsDevice> {
    return this.#post('/v2/rps/devices', input);
  }

  /** Sent as a bare array. */
  async addRpsDevices(devices: CreateRpsDeviceInput[]): Promise<YmcsBulkResult> {
    return this.#post('/v2/rps/addDevices', devices);
  }

  async updateRpsDevice(rpsDeviceId: string, patch: Partial<CreateRpsDeviceInput>): Promise<void> {
    return this.#patch(`/v2/rps/devices/${segment('rpsDeviceId', rpsDeviceId)}`, nonEmpty('updateRpsDevice', patch));
  }

  /** Bulk delete by RPS id (`'id'`) or by MAC (`'mac'`). A MAC not in RPS is a per-item failure. */
  async deleteRpsDevices(deviceIds: string[], deviceIdType: 'id' | 'mac'): Promise<YmcsBulkResult> {
    return this.#post('/v2/rps/delDevices', { deviceIdType, deviceIds });
  }

  async createRpsServer(input: CreateRpsServerInput): Promise<YmcsRpsServer> {
    return this.#post('/v2/rps/servers', input);
  }

  /** `serverName` and `url` are both required on every update; either alone answers 400. */
  async updateRpsServer(rpsServerId: string, input: CreateRpsServerInput): Promise<void> {
    return this.#patch(`/v2/rps/servers/${segment('rpsServerId', rpsServerId)}`, input);
  }

  /** Bulk delete. The API has no single-server DELETE (it answers 405). */
  async deleteRpsServers(rpsServerIds: string[]): Promise<YmcsBulkResult> {
    return this.#post('/v2/rps/delServers', { serverIds: rpsServerIds });
  }
}
