import { describe, expect, it } from 'vitest';
import { clampPageSize, listAll, MAX_DEVICES_PAGE_SIZE, MAX_PAGE_SIZE, type PageRequest } from './paginate.js';
import { page } from './testkit.js';

function server(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: `row-${i}` }));
  const seen: PageRequest[] = [];
  return {
    seen,
    fetchPage: async (p: PageRequest) => {
      seen.push(p);
      return page(rows.slice(p.skip, p.skip + p.limit), total, p.skip, p.limit);
    },
  };
}

describe('clampPageSize', () => {
  it('defaults to the endpoint cap and never exceeds it', () => {
    expect(clampPageSize({})).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize({ pageSize: 9999 })).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize({ pageSize: 9999, maxPageSize: MAX_DEVICES_PAGE_SIZE })).toBe(100);
    expect(clampPageSize({ pageSize: 0 })).toBe(1);
    expect(clampPageSize({ pageSize: 7.9 })).toBe(7);
  });
  it('never asks for more than limit', () => {
    expect(clampPageSize({ limit: 5 })).toBe(5);
    expect(clampPageSize({ limit: 5, pageSize: 3 })).toBe(3);
  });
});

describe('listAll', () => {
  it('walks every page, counting only on the first', async () => {
    const s = server(1150);
    const out = await listAll(s.fetchPage);
    expect(out).toHaveLength(1150);
    expect(s.seen.map((p) => [p.skip, p.limit, p.autoCount])).toEqual([
      [0, 500, true],
      [500, 500, false],
      [1000, 500, false],
    ]);
  });

  it('stops at limit and slices the tail', async () => {
    const s = server(1150);
    const out = await listAll(s.fetchPage, { limit: 620 });
    expect(out).toHaveLength(620);
    expect(out[619]).toEqual({ id: 'row-619' });
    expect(s.seen).toHaveLength(2);
  });

  it('a short page ends the walk even when total lies', async () => {
    const seen: PageRequest[] = [];
    const out = await listAll(async (p) => {
      seen.push(p);
      return page([{ id: 'a' }, { id: 'b' }], 9999, p.skip, p.limit);
    });
    expect(out).toHaveLength(2);
    expect(seen).toHaveLength(1);
  });

  it('a full page with no total keeps walking until an empty one', async () => {
    let calls = 0;
    const out = await listAll(
      async (p) => {
        calls++;
        return { skip: p.skip, limit: p.limit, data: calls <= 2 ? [{ id: `r${calls}` }, { id: `s${calls}` }] : [] };
      },
      { pageSize: 2 },
    );
    expect(out).toHaveLength(4);
    expect(calls).toBe(3);
  });

  it('limit 0 fetches nothing', async () => {
    const s = server(10);
    expect(await listAll(s.fetchPage, { limit: 0 })).toEqual([]);
    expect(s.seen).toHaveLength(0);
  });

  it('tolerates a page with no data array', async () => {
    expect(await listAll(async (p) => ({ skip: p.skip, limit: p.limit, data: undefined as never }))).toEqual([]);
  });
});
