import { describe, expect, it } from 'vitest';
import * as lib from './index.js';

describe('public barrel', () => {
  it('exports both clients and the auth helpers, but never the transport', () => {
    expect(typeof lib.YmcsReadClient).toBe('function');
    expect(typeof lib.YmcsWriteClient).toBe('function');
    expect(typeof lib.fetchAccessToken).toBe('function');
    expect(typeof lib.memoryCache).toBe('function');
    expect(lib.DeviceType).toEqual({ All: 0, Phone: 1, Room: 3 });
    expect((lib as Record<string, unknown>).YmcsHttp).toBeUndefined();
    expect((lib as Record<string, unknown>).listEndpoint).toBeUndefined();
    expect((lib as Record<string, unknown>).segment).toBeUndefined();
  });
});
