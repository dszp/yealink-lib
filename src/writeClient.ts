/**
 * YmcsWriteClient — the only sanctioned mutation surface. A separate class over the same private
 * transport, so a consumer that holds only a `YmcsReadClient` cannot reach any of this.
 *
 * Request shapes are lifted from the n8n node (`@dszp/n8n-nodes-yealinkymcs`), where each one was
 * exercised against live YMCS. Two facts that shaped them:
 *
 *   - YMCS answers every update (PATCH) and single delete (DELETE) with 204 and no body, so those
 *     methods return `void`. Create calls return whatever the server sends (usually the new `id`).
 *   - A POST with no body at all answers 412 (code 900444), while `{}` is accepted. Methods that
 *     take no parameters therefore send `{}` explicitly.
 *
 * `request()` / `requestAllItems()` are the escape hatch for endpoints this library does not name.
 * They live HERE and not on the read client on purpose: holding a write client already means you
 * can write, so a passthrough adds no new capability.
 */

import { YmcsHttp, type YmcsConfig, type RequestOptions } from './http.js';
import { listEndpoint, segment } from './readClient.js';
import type { DeviceType, DiagnosisStarted, ListOptions, Rec } from './model.js';

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

export interface CreateSipAccountInput extends Rec {
  registerName: string;
  username: string;
  password: string;
  sipServer1Host: string;
  sipServer1Port: number;
  displayName?: string;
  label?: string;
  siteId?: string;
  remark?: string;
  sipServer2Host?: string;
  sipServer2Port?: number;
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

export interface DeviceConfigInput extends Rec {
  name: string;
  modelId: string;
}

export interface SiteConfigInput extends Rec {
  name: string;
  siteId: string;
  deviceType: 1 | 3;
}

export interface GroupConfigInput extends Rec {
  name: string;
  deviceGroupId: string;
  deviceType: 1 | 3;
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

  async createSite(input: CreateSiteInput): Promise<Rec> {
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

  async createDevice(input: CreateDeviceInput): Promise<Rec> {
    return this.#post('/v2/dm/devices', input);
  }

  /** Bulk add with MAC + serial (`POST /v2/dm/addDevices`). */
  async addDevices(devices: Array<Pick<CreateDeviceInput, 'mac' | 'sn' | 'deviceType' | 'modelId'> & Rec>): Promise<Rec> {
    return this.#post('/v2/dm/addDevices', { devices });
  }

  /** Bulk add by MAC only (`POST /v2/dm/addDevicesByMac`); the enterprise must be enabled for it. */
  async addDevicesByMac(devices: Array<{ mac: string; deviceType: 1 | 3; modelId: string } & Rec>): Promise<Rec> {
    return this.#post('/v2/dm/addDevicesByMac', { devices });
  }

  /** Fields: `name`, `siteId` (move). At least one. */
  async updateDevice(deviceId: string, patch: { name?: string; siteId?: string } & Rec): Promise<void> {
    return this.#patch(`/v2/dm/devices/${segment('deviceId', deviceId)}`, nonEmpty('updateDevice', patch));
  }

  async deleteDevice(deviceId: string): Promise<void> {
    return this.#delete(`/v2/dm/devices/${segment('deviceId', deviceId)}`);
  }

  /** Bulk delete. `deviceIds` are YMCS ids, or MACs when `deviceIdType: 'mac'`. */
  async deleteDevices(deviceIds: string[], deviceType: 1 | 3, extra: { deviceIdType?: 'id' | 'mac' } & Rec = {}): Promise<Rec> {
    return this.#post('/v2/dm/delDevices', { deviceIds, deviceType, ...extra });
  }

  async rebootDevices(deviceIds: string[], deviceType: 1 | 3): Promise<Rec> {
    return this.#post('/v2/dm/device/reboot', { deviceIds, deviceType });
  }

  /** Factory reset. Irreversible on the handset; the device re-provisions from RPS afterwards. */
  async resetDevices(deviceIds: string[], deviceType: 1 | 3): Promise<Rec> {
    return this.#post('/v2/dm/device/reset', { deviceIds, deviceType });
  }

  /** Reboot accessories. An empty `partIds` reboots every part on the device. */
  async rebootDeviceParts(deviceId: string, partIds: string[] = []): Promise<Rec> {
    return this.#post(`/v2/dm/devices/${segment('deviceId', deviceId)}/parts/reboot`, partIds.length ? { partIds } : {});
  }

  async resetDeviceParts(deviceId: string, partIds: string[] = []): Promise<Rec> {
    return this.#post(`/v2/dm/devices/${segment('deviceId', deviceId)}/parts/reset`, partIds.length ? { partIds } : {});
  }

  /** Bind SIP accounts to line keys. Each entry: `{ accountId, lineId? }` per the API. */
  async bindAccounts(deviceId: string, accounts: Rec[]): Promise<Rec> {
    return this.#post(`/v2/dm/devices/${segment('deviceId', deviceId)}/bindAccounts`, { accounts });
  }

  async unbindAccounts(deviceId: string, accountIds: string[]): Promise<Rec> {
    return this.#post(`/v2/dm/devices/${segment('deviceId', deviceId)}/unbindAccounts`, { accountIds });
  }

  // ── Device groups ──────────────────────────────────────────────────────────────

  /** The API's body field is `name` (the n8n node calls it Group Name). */
  async createDeviceGroup(input: { name: string; deviceType: 1 | 3; description?: string } & Rec): Promise<Rec> {
    return this.#post('/v2/dm/deviceGroups', input);
  }

  /** `name` and `deviceType` are both REQUIRED by the API on update, not just the changed field. */
  async updateDeviceGroup(deviceGroupId: string, input: { name: string; deviceType: 1 | 3; description?: string } & Rec): Promise<void> {
    return this.#patch(`/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}`, input);
  }

  async deleteDeviceGroup(deviceGroupId: string): Promise<void> {
    return this.#delete(`/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}`);
  }

  async addDevicesToGroup(deviceGroupId: string, deviceIds: string[]): Promise<Rec> {
    return this.#post(`/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}/addDevices`, { deviceIds });
  }

  async removeDevicesFromGroup(deviceGroupId: string, deviceIds: string[]): Promise<Rec> {
    return this.#post(`/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}/delDevices`, { deviceIds });
  }

  // ── SIP accounts ───────────────────────────────────────────────────────────────

  async createSipAccount(input: CreateSipAccountInput): Promise<Rec> {
    return this.#post('/v2/dm/sipAccounts', input);
  }

  async updateSipAccount(accountId: string, patch: Partial<CreateSipAccountInput>): Promise<void> {
    return this.#patch(`/v2/dm/sipAccounts/${segment('accountId', accountId)}`, nonEmpty('updateSipAccount', patch));
  }

  /** Bulk delete, maximum 200 ids per call (server limit). */
  async deleteSipAccounts(accountIds: string[]): Promise<Rec> {
    return this.#post('/v2/dm/delAccounts', { accountIds });
  }

  // ── Configuration templates ────────────────────────────────────────────────────

  async createDeviceConfig(input: DeviceConfigInput): Promise<Rec> {
    return this.#post('/v2/dm/deviceConfigs', input);
  }

  /** `name` and `modelId` are required on update. */
  async updateDeviceConfig(configId: string, input: DeviceConfigInput): Promise<void> {
    return this.#patch(`/v2/dm/deviceConfigs/${segment('configId', configId)}`, input);
  }

  async deleteDeviceConfigs(configIds: string[]): Promise<Rec> {
    return this.#post('/v2/dm/delDeviceConfigs', { configIds });
  }

  async pushDeviceConfig(configId: string): Promise<Rec> {
    return this.#post(`/v2/dm/deviceConfigs/${segment('configId', configId)}/push`);
  }

  async createSiteConfig(input: SiteConfigInput): Promise<Rec> {
    return this.#post('/v2/dm/siteConfigs', input);
  }

  async updateSiteConfig(configId: string, input: SiteConfigInput): Promise<void> {
    return this.#patch(`/v2/dm/siteConfigs/${segment('configId', configId)}`, input);
  }

  async deleteSiteConfigs(configIds: string[]): Promise<Rec> {
    return this.#post('/v2/dm/delSiteConfigs', { configIds });
  }

  async pushSiteConfig(configId: string): Promise<Rec> {
    return this.#post(`/v2/dm/siteConfigs/${segment('configId', configId)}/push`);
  }

  async createGroupConfig(input: GroupConfigInput): Promise<Rec> {
    return this.#post('/v2/dm/groupConfigs', input);
  }

  async updateGroupConfig(configId: string, input: GroupConfigInput): Promise<void> {
    return this.#patch(`/v2/dm/groupConfigs/${segment('configId', configId)}`, input);
  }

  async deleteGroupConfigs(configIds: string[]): Promise<Rec> {
    return this.#post('/v2/dm/delGroupConfigs', { configIds });
  }

  async pushGroupConfig(configId: string): Promise<Rec> {
    return this.#post(`/v2/dm/groupConfigs/${segment('configId', configId)}/push`);
  }

  // ── Firmware ───────────────────────────────────────────────────────────────────

  async pushFirmware(firmwareId: string, deviceIds: string[], deviceType: 1 | 3): Promise<Rec> {
    return this.#post(`/v2/dm/firmwares/${segment('firmwareId', firmwareId)}/push`, { deviceIds, deviceType });
  }

  /** Wire path is `officalFirmwares` — Yealink's spelling, matched exactly. */
  async pushOfficialFirmware(officialFirmwareId: string, deviceIds: string[], deviceType: 1 | 3): Promise<Rec> {
    return this.#post(`/v2/dm/officalFirmwares/${segment('officialFirmwareId', officialFirmwareId)}/push`, { deviceIds, deviceType });
  }

  // ── Diagnosis (all answer a diagnosisId to poll with the read client) ─────────

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

  async createRpsDevice(input: CreateRpsDeviceInput): Promise<Rec> {
    return this.#post('/v2/rps/devices', input);
  }

  async addRpsDevices(devices: CreateRpsDeviceInput[]): Promise<Rec> {
    return this.#post('/v2/rps/addDevices', { devices });
  }

  async updateRpsDevice(rpsDeviceId: string, patch: Partial<CreateRpsDeviceInput>): Promise<void> {
    return this.#patch(`/v2/rps/devices/${segment('rpsDeviceId', rpsDeviceId)}`, nonEmpty('updateRpsDevice', patch));
  }

  /** Bulk delete by YMCS id (`idType: 'id'`) or by MAC (`idType: 'mac'`). */
  async deleteRpsDevices(ids: string[], idType: 'id' | 'mac'): Promise<void> {
    return this.#post(`/v2/rps/deleteDevices`, { ids, idType }).then(() => undefined);
  }

  async createRpsServer(input: CreateRpsServerInput): Promise<Rec> {
    return this.#post('/v2/rps/servers', input);
  }

  async updateRpsServer(rpsServerId: string, patch: Partial<CreateRpsServerInput>): Promise<void> {
    return this.#patch(`/v2/rps/servers/${segment('rpsServerId', rpsServerId)}`, nonEmpty('updateRpsServer', patch));
  }

  async deleteRpsServer(rpsServerId: string): Promise<void> {
    return this.#delete(`/v2/rps/servers/${segment('rpsServerId', rpsServerId)}`);
  }
}
