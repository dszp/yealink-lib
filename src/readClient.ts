/**
 * YmcsReadClient — the only exported read surface. Holds the transport privately, so a consumer
 * that has one KNOWS it cannot write.
 *
 * "Read" here means: every `GET`, and every `POST /v2/.../list*` — YMCS lists by POST because the
 * filter is a JSON object, not because listing mutates anything. `resolveDeviceIds` (POST
 * `/v2/dm/deviceId`) is the one non-`list*` POST here; it is a lookup table from MAC to id.
 *
 * READ/WRITE CHARTER ENFORCEMENT: the no-mutating-methods test in `readClient.test.ts` checks
 * `Object.getOwnPropertyNames` on BOTH the prototype and an instance. A method declared with normal
 * `method() {}` syntax lands on the prototype; an arrow-function class field lands as an OWN
 * property of the instance and would evade a prototype-only check. Keep new methods on the
 * prototype (plain method syntax).
 */

import { YmcsHttp, type YmcsConfig, type RequestOptions } from './http.js';
import { listAll, MAX_DEVICES_PAGE_SIZE, MAX_PAGE_SIZE, type PageRequest } from './paginate.js';
import type {
  DeviceFilter,
  DeviceIdLookup,
  DeviceType,
  ListOptions,
  Rec,
  YmcsAlarm,
  YmcsBoundAccount,
  YmcsDevice,
  YmcsDeviceGroup,
  YmcsDiagnosisStatus,
  YmcsFirmware,
  YmcsModel,
  YmcsOperationLog,
  YmcsPage,
  YmcsRpsDevice,
  YmcsRpsServer,
  YmcsSipAccount,
  YmcsSite,
} from './model.js';

/**
 * Shared by both clients (the write client's `requestAllItems` passthrough uses it too). Exported
 * for that reason, but NOT re-exported from the barrel — it takes a transport, which is internal.
 */
export function listEndpoint<T>(
  http: YmcsHttp,
  path: string,
  opts: ListOptions<Rec> & { maxPageSize?: number; dataKey?: string } = {},
): Promise<T[]> {
  const dataKey = opts.dataKey ?? 'data';
  const fetchPage = async (page: PageRequest): Promise<YmcsPage<T>> => {
    // `filter` is ALWAYS sent, as `{}` when the caller gave none. Most list endpoints tolerate its
    // absence, but `listOfficalFirmwares` answers 400 (code 900400, "filter: Cannot be null") —
    // verified live 2026-09-22. `{}` is accepted everywhere.
    const body: Rec = { ...page, filter: opts.filter ?? {} };
    const raw = await http.request<Rec>('POST', path, { body });
    return { skip: page.skip, limit: page.limit, total: raw.total as number | undefined, data: (raw[dataKey] as T[]) ?? [] };
  };
  return listAll(fetchPage, { limit: opts.limit, pageSize: opts.pageSize, maxPageSize: opts.maxPageSize ?? MAX_PAGE_SIZE });
}

/** A path segment that would change which endpoint is called is refused before it reaches the URL. */
export function segment(name: string, value: string): string {
  if (!value || value === '.' || value === '..' || /[/?#\s]/.test(value)) {
    throw new Error(`yealink-lib: ${name} ${JSON.stringify(value)} is not a valid path segment`);
  }
  return encodeURIComponent(value);
}

export class YmcsReadClient {
  readonly #http: YmcsHttp;

  constructor(cfg: YmcsConfig) {
    this.#http = new YmcsHttp(cfg);
  }

  /** The resolved base URL (`https://us-api.ymcs.yealink.com` for region `us`). Handy for logs. */
  get baseUrl(): string {
    return this.#http.baseUrl;
  }

  #get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.#http.request<T>('GET', path, opts);
  }

  // ── Sites ──────────────────────────────────────────────────────────────────────

  async getSite(siteId: string): Promise<YmcsSite> {
    return this.#get(`/v2/dm/sites/${segment('siteId', siteId)}`);
  }

  /** Filter: `{ name? }` (fuzzy). */
  async listSites(opts: ListOptions<{ name?: string } & Rec> = {}): Promise<YmcsSite[]> {
    return listEndpoint(this.#http, '/v2/dm/listSites', opts);
  }

  // ── Devices ────────────────────────────────────────────────────────────────────

  async getDevice(deviceId: string): Promise<YmcsDevice> {
    return this.#get(`/v2/dm/devices/${segment('deviceId', deviceId)}`);
  }

  /** The device's effective configuration (`GET /v2/dm/devices/{id}/configs`). */
  async getDeviceConfigs(deviceId: string): Promise<Rec> {
    return this.#get(`/v2/dm/devices/${segment('deviceId', deviceId)}/configs`);
  }

  /** ⚠️ This endpoint caps pages at 100, not 500 — handled here; do not pass a larger `pageSize`. */
  async listDevices(opts: ListOptions<DeviceFilter> = {}): Promise<YmcsDevice[]> {
    return listEndpoint(this.#http, '/v2/dm/listDevices', { ...opts, maxPageSize: MAX_DEVICES_PAGE_SIZE });
  }

  /**
   * MAC → device id, for devices the enterprise owns. Keys the server does not know are simply
   * absent from the answer, so a short result is a partial match, not an error.
   */
  async resolveDeviceIds(macs: string[], deviceType: DeviceType): Promise<DeviceIdLookup[]> {
    return this.#http.request<DeviceIdLookup[]>('POST', '/v2/dm/deviceId', {
      body: { deviceType, deviceIds: macs, deviceIdType: 'mac' },
    });
  }

  /** Accessories (handsets, expansion modules) attached to a device. */
  async listDeviceParts(deviceId: string, opts: ListOptions = {}): Promise<Rec[]> {
    return listEndpoint(this.#http, `/v2/dm/devices/${segment('deviceId', deviceId)}/listParts`, opts);
  }

  async getDevicePart(deviceId: string, partId: string): Promise<Rec> {
    return this.#get(`/v2/dm/devices/${segment('deviceId', deviceId)}/parts/${segment('partId', partId)}`);
  }

  /**
   * Accounts bound to a PHONE's line keys. Not paginated upstream; the `{ data }` envelope is
   * unwrapped here. ⚠️ Phones only — a room device (MeetingBar, CTP) answers 400 code 800005
   * "Illegal device type" (verified live 2026-09-22), which surfaces as a `YmcsApiError`.
   */
  async listBoundAccounts(deviceId: string): Promise<YmcsBoundAccount[]> {
    const raw = await this.#get<unknown>(`/v2/dm/devices/${segment('deviceId', deviceId)}/boundAccounts`);
    if (Array.isArray(raw)) return raw as YmcsBoundAccount[];
    const data = (raw as Rec | null)?.data;
    return Array.isArray(data) ? (data as YmcsBoundAccount[]) : [];
  }

  async getNetworkInterfaces(deviceId: string): Promise<Rec> {
    return this.#get(`/v2/dm/devices/${segment('deviceId', deviceId)}/networkInterfaces`);
  }

  // ── Device groups ──────────────────────────────────────────────────────────────

  /** Filter: `{ deviceType?, groupName? }`. */
  async listDeviceGroups(opts: ListOptions<{ deviceType?: DeviceType; groupName?: string } & Rec> = {}): Promise<YmcsDeviceGroup[]> {
    return listEndpoint(this.#http, '/v2/dm/listDeviceGroups', opts);
  }

  /** Filter: `{ deviceStatus?, mac?, modelId? }`. */
  async listGroupDevices(deviceGroupId: string, opts: ListOptions<DeviceFilter> = {}): Promise<YmcsDevice[]> {
    return listEndpoint(this.#http, `/v2/dm/deviceGroups/${segment('deviceGroupId', deviceGroupId)}/listDevices`, opts);
  }

  // ── SIP accounts ───────────────────────────────────────────────────────────────

  /** Filter: `{ username? }`. */
  async listSipAccounts(opts: ListOptions<{ username?: string } & Rec> = {}): Promise<YmcsSipAccount[]> {
    return listEndpoint(this.#http, '/v2/dm/listAccounts', opts);
  }

  // ── Configuration templates (device / site / group) ────────────────────────────

  async getDeviceConfig(configId: string): Promise<Rec> {
    return this.#get(`/v2/dm/deviceConfigs/${segment('configId', configId)}`);
  }

  async listDeviceConfigs(opts: ListOptions = {}): Promise<Rec[]> {
    return listEndpoint(this.#http, '/v2/dm/listDeviceConfigs', opts);
  }

  async getSiteConfig(configId: string): Promise<Rec> {
    return this.#get(`/v2/dm/siteConfigs/${segment('configId', configId)}`);
  }

  async listSiteConfigs(opts: ListOptions = {}): Promise<Rec[]> {
    return listEndpoint(this.#http, '/v2/dm/listSiteConfigs', opts);
  }

  async getGroupConfig(configId: string): Promise<Rec> {
    return this.#get(`/v2/dm/groupConfigs/${segment('configId', configId)}`);
  }

  async listGroupConfigs(opts: ListOptions = {}): Promise<Rec[]> {
    return listEndpoint(this.#http, '/v2/dm/listGroupConfigs', opts);
  }

  // ── Firmware and models ────────────────────────────────────────────────────────

  /** Custom (enterprise-uploaded) firmware. Filter: `{ deviceType?, modelId?, firmwareType? }`. */
  async listFirmwares(opts: ListOptions<{ deviceType?: DeviceType; modelId?: string; firmwareType?: number } & Rec> = {}): Promise<YmcsFirmware[]> {
    return listEndpoint(this.#http, '/v2/dm/listFirmwares', opts);
  }

  async getFirmware(firmwareId: string): Promise<YmcsFirmware> {
    return this.#get(`/v2/dm/firmwares/${segment('firmwareId', firmwareId)}`);
  }

  /**
   * Yealink-published firmware for ONE model. `modelId` is required by the server (verified live
   * 2026-09-22: 400 code 900400 "modelId: Cannot be empty" without it), so it is positional here
   * rather than an optional filter key — get ids from `listModels`.
   * The wire path is `listOfficalFirmwares` — Yealink's spelling, matched exactly; only the method
   * name is corrected.
   */
  async listOfficialFirmwares(modelId: string, opts: ListOptions<Rec> = {}): Promise<YmcsFirmware[]> {
    if (!modelId) throw new Error('yealink-lib: listOfficialFirmwares needs a modelId (the server rejects an empty one)');
    return listEndpoint(this.#http, '/v2/dm/listOfficalFirmwares', { ...opts, filter: { ...(opts.filter ?? {}), modelId } });
  }

  /** Device models for a device type. The only list that is a `GET` with a query string, and unpaginated. */
  async listModels(deviceType: DeviceType): Promise<YmcsModel[]> {
    const raw = await this.#get<unknown>('/v2/dm/models', { query: { deviceType } });
    if (Array.isArray(raw)) return raw as YmcsModel[];
    const data = (raw as Rec | null)?.data;
    return Array.isArray(data) ? (data as YmcsModel[]) : [];
  }

  // ── Alarms, logs, diagnosis ────────────────────────────────────────────────────

  /** Filter: `{ deviceType?, mac? }`. */
  async listAlarms(opts: ListOptions<{ deviceType?: DeviceType; mac?: string } & Rec> = {}): Promise<YmcsAlarm[]> {
    return listEndpoint(this.#http, '/v2/dm/listAlarms', opts);
  }

  /** Filter: `{ startTime?, endTime? }` as epoch milliseconds. */
  async listOperationLogs(opts: ListOptions<{ startTime?: number; endTime?: number } & Rec> = {}): Promise<YmcsOperationLog[]> {
    return listEndpoint(this.#http, '/v2/dm/listOpLogs', opts);
  }

  /** Poll this after any diagnosis start call; `url` appears once `status` is `success`. */
  async getDiagnosisStatus(diagnosisId: string): Promise<YmcsDiagnosisStatus> {
    return this.#get(`/v2/dm/diagnosis/${segment('diagnosisId', diagnosisId)}/status`);
  }

  // ── RPS (redirect / zero-touch provisioning) ───────────────────────────────────

  /** Filter: `{ mac? }`. */
  async listRpsDevices(opts: ListOptions<{ mac?: string } & Rec> = {}): Promise<YmcsRpsDevice[]> {
    return listEndpoint(this.#http, '/v2/rps/listDevices', opts);
  }

  async getRpsDevice(rpsDeviceId: string): Promise<YmcsRpsDevice> {
    return this.#get(`/v2/rps/devices/${segment('rpsDeviceId', rpsDeviceId)}`);
  }

  /** Filter: `{ searchKey?, name? }`. */
  async listRpsServers(opts: ListOptions<{ searchKey?: string; name?: string } & Rec> = {}): Promise<YmcsRpsServer[]> {
    return listEndpoint(this.#http, '/v2/rps/listServers', opts);
  }
}
