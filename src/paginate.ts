/**
 * The one pagination pattern every YMCS list endpoint uses: `POST` with `{ skip, limit, autoCount }`
 * in the body (plus an endpoint-specific `filter`), answering `{ skip, limit, total?, data }`.
 *
 * `autoCount` is sent `true` on the first page only — the reference recommends this, since counting
 * is the expensive half of the query — and the loop is driven by that first `total`. It also stops
 * on an empty or short page, so an endpoint that omits `total` (or a fleet that shrinks mid-walk)
 * terminates rather than spinning.
 */

import type { YmcsPage } from './model.js';

/** The server's maximum page size for every list endpoint except `listDevices`. */
export const MAX_PAGE_SIZE = 500;
/** `POST /v2/dm/listDevices` caps `limit` at 100 and answers 400 above it. */
export const MAX_DEVICES_PAGE_SIZE = 100;

export interface PageRequest {
  skip: number;
  limit: number;
  autoCount: boolean;
}

export interface ListAllOptions {
  /** Stop after this many items (the tail of the last page is sliced off). Omit for everything. */
  limit?: number;
  /** Records per request. Clamped to `maxPageSize`. */
  pageSize?: number;
  /** The endpoint's server-side cap. Default `MAX_PAGE_SIZE`. */
  maxPageSize?: number;
}

/** The wire-level page size: floor 1, ceiling `maxPageSize`, integer-truncated; never above `limit`. */
export function clampPageSize(opts: ListAllOptions): number {
  const max = opts.maxPageSize ?? MAX_PAGE_SIZE;
  let size = opts.pageSize === undefined ? max : Math.min(max, Math.max(1, Math.trunc(opts.pageSize)));
  if (opts.limit !== undefined && opts.limit > 0 && opts.limit < size) size = Math.trunc(opts.limit);
  return size;
}

/**
 * Walk every page. `fetchPage` receives the paging triple and returns one page; the caller merges
 * it into whatever body the endpoint wants (`{ ...page, filter }`).
 */
export async function listAll<T>(
  fetchPage: (page: PageRequest) => Promise<YmcsPage<T>>,
  opts: ListAllOptions = {},
): Promise<T[]> {
  const out: T[] = [];
  if (opts.limit !== undefined && opts.limit <= 0) return out;
  const limit = opts.limit !== undefined ? Math.trunc(opts.limit) : undefined;
  const pageSize = clampPageSize(opts);

  let total: number | undefined;
  let first = true;
  for (;;) {
    const page = await fetchPage({ skip: out.length, limit: pageSize, autoCount: first });
    const items = Array.isArray(page?.data) ? page.data : [];
    if (first && typeof page?.total === 'number') total = page.total;
    first = false;
    out.push(...items);
    if (limit !== undefined && out.length >= limit) return out.slice(0, limit);
    if (items.length === 0 || items.length < pageSize) break;
    if (total !== undefined && out.length >= total) break;
  }
  return out;
}
