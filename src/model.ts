/**
 * Types for the Yealink Management Cloud Service (YMCS) Open API V4X.
 *
 * Hand-written from the V4X reference's examples, not generated from a schema — Yealink publishes
 * no machine-readable spec. Every record type therefore carries an index signature: the examples
 * show the fields that matter, and the live API returns more than the examples show. Treat the
 * named fields as verified and anything else as `unknown`.
 */

/** A loosely-typed JSON object. */
export type Rec = Record<string, unknown>;

/** The three public YMCS regions. Each is its own host: `https://<region>-api.ymcs.yealink.com`. */
export type YmcsRegion = 'us' | 'eu' | 'au';

/**
 * YMCS's device-type discriminator. Sent on most device-scoped calls and filters.
 * `0` means "all" and is valid ONLY in list filters — a create or a push needs 1 or 3.
 */
export const DeviceType = {
  All: 0,
  Phone: 1,
  Room: 3,
} as const;
export type DeviceType = (typeof DeviceType)[keyof typeof DeviceType];

/** One page of a `POST /v2/.../list*` response. `total` is present only when `autoCount` was true. */
export interface YmcsPage<T> {
  skip: number;
  limit: number;
  total?: number;
  data: T[];
}

/** Options every list method accepts. */
export interface ListOptions<F = Rec> {
  /** Server-side filter object, passed verbatim as `filter`. Fields are endpoint-specific. */
  filter?: F;
  /** Stop after this many items. Omit to fetch every page. */
  limit?: number;
  /**
   * Records per request. Defaults to the endpoint's maximum (500, or 100 for `listDevices`).
   * A value above the endpoint's maximum is clamped, because the server answers 400 rather
   * than clamping it for you.
   */
  pageSize?: number;
}

export interface YmcsSite extends Rec {
  id: string;
  name: string;
  parentId?: string | null;
  level?: number;
  sequence?: number;
  description?: string;
}

export interface YmcsDevice extends Rec {
  id: string;
  mac: string;
  sn?: string;
  name?: string;
  modelId?: string;
  siteId?: string;
  programVersion?: string;
  /** `online` | `offline` | `pending` (never reported). Numeric in filters (1 / 0 / -1); a string here. */
  deviceStatus?: string;
}

/** Filter for `listDevices`. Status codes are the server's: device 1 online / 0 offline / -1 not reported; account 1 registered / 2 DND / 3 unregistered. */
export interface DeviceFilter extends Rec {
  /** Fuzzy MAC match, with or without separators. */
  mac?: string;
  modelId?: string;
  deviceStatus?: 1 | 0 | -1;
  accountStatus?: 1 | 2 | 3;
  deviceType?: DeviceType;
  siteId?: string;
}

export interface YmcsDeviceGroup extends Rec {
  id: string;
  name: string;
  deviceType?: DeviceType;
  /** The API capitalizes this field in responses. */
  Description?: string;
}

export interface YmcsSipAccount extends Rec {
  id: string;
  registerInfo?: string;
  username?: string;
  accountType?: number;
  createTime?: number;
}

export interface YmcsModel extends Rec {
  id: string;
  name: string;
}

export interface YmcsFirmware extends Rec {
  id: string;
  name?: string;
  deviceType?: DeviceType;
  /** 0 master device, 1 accessory. */
  firmwareType?: number;
  version?: string;
}

export interface YmcsAlarm extends Rec {
  id: string;
  event?: string;
  level?: number;
  mac?: string;
  model?: string;
  ip?: string;
  siteName?: string;
  status?: number;
  firstAlarmTime?: number;
}

export interface YmcsOperationLog extends Rec {
  module?: string;
  operationObject?: string;
  operator?: string;
  ip?: string;
  /** Epoch milliseconds, delivered as a string. */
  createTime?: string;
  result?: string;
}

export interface YmcsRpsDevice extends Rec {
  id: string;
  mac: string;
  sn?: string;
  serverId?: string;
  serverName?: string;
  serverUrl?: string;
  ipAddress?: string | null;
  dateRegistered?: number;
  lastConnected?: number | null;
  remark?: string;
}

export interface YmcsRpsServer extends Rec {
  id: string;
  serverName: string;
  url: string;
  authName?: string;
}

/** Answer to `POST /v2/dm/deviceId`: one row per requested key that the enterprise owns. */
export interface DeviceIdLookup {
  key: string;
  deviceId: string;
}

/** `GET /v2/dm/diagnosis/{id}/status`. `url` is a time-limited download link once `status` is `success`. */
export interface YmcsDiagnosisStatus extends Rec {
  deviceId?: string;
  status?: string;
  url?: string;
}

/** The result of any diagnosis start call: poll `getDiagnosisStatus(diagnosisId)`. */
export interface DiagnosisStarted extends Rec {
  diagnosisId?: string;
}
