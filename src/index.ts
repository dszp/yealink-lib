/**
 * Public API of @dszp/yealink-lib.
 *
 * READ/WRITE BOUNDARY: the transport `YmcsHttp` is deliberately NOT exported. `YmcsReadClient`
 * holds it privately and exposes no mutating methods; `YmcsWriteClient` is the only sanctioned
 * mutation surface. Exporting the transport would let a consumer bypass that in one line.
 */

export type {
  Rec,
  YmcsRegion,
  YmcsPage,
  ListOptions,
  YmcsSite,
  YmcsDevice,
  DeviceFilter,
  YmcsDeviceGroup,
  YmcsSipAccount,
  YmcsModel,
  YmcsFirmware,
  YmcsAlarm,
  YmcsBoundAccount,
  YmcsOperationLog,
  YmcsRpsDevice,
  YmcsRpsServer,
  DeviceIdLookup,
  YmcsDiagnosisStatus,
  DiagnosisStarted,
} from './model.js';
export { DeviceType } from './model.js';

// Auth: the token exchange and the per-request headers, for consumers that pre-warm a cache.
export {
  fetchAccessToken,
  resolveBaseUrl,
  nonce,
  replayHeaders,
  YmcsAuthError,
  REGION_HOSTS,
  type YmcsEndpoint,
  type TokenRequest,
  type AccessToken,
} from './auth.js';

export { memoryCache, type TokenCache } from './cache.js';

// Error + config types (NOT the YmcsHttp class — see boundary note above)
export {
  YmcsApiError,
  TOKEN_REFRESH_SKEW_MS,
  type YmcsConfig,
  type YmcsErrorDetail,
  type RequestOptions,
} from './http.js';

export { MAX_PAGE_SIZE, MAX_DEVICES_PAGE_SIZE, type ListAllOptions, type PageRequest } from './paginate.js';

// Read-only client
export { YmcsReadClient } from './readClient.js';

// Write client — the only sanctioned mutation surface
export {
  YmcsWriteClient,
  type HttpMethod,
  type CreateDeviceInput,
  type CreateSiteInput,
  type CreateSipAccountInput,
  type CreateRpsDeviceInput,
  type CreateRpsServerInput,
  type DeviceConfigInput,
  type SiteConfigInput,
  type GroupConfigInput,
} from './writeClient.js';
