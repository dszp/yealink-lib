import { describe, expect, expectTypeOf, it } from 'vitest';
import { DeviceType } from './model.js';
import { YmcsReadClient, segment } from './readClient.js';
import { CREDS, mockFetch, page, type MockFetchOptions } from './testkit.js';

function client(opts: MockFetchOptions = {}) {
  const mock = mockFetch(opts);
  return { mock, c: new YmcsReadClient({ ...CREDS, fetchImpl: mock.fetchImpl }) };
}

describe('the read-only boundary', () => {
  const MUTATING = /^(create|add|update|patch|delete|del|remove|push|reboot|reset|bind|unbind|start|stop|export|capture|ping|traceroute|request|post|put)/i;

  it('exposes no mutating method on the prototype or an instance', () => {
    const proto = Object.getOwnPropertyNames(YmcsReadClient.prototype).filter((n) => n !== 'constructor');
    const own = Object.getOwnPropertyNames(new YmcsReadClient(CREDS));
    for (const name of [...proto, ...own]) expect(name, name).not.toMatch(MUTATING);
    expect(proto.length).toBeGreaterThan(20);
  });

  it('is enforced at the type level too', () => {
    expectTypeOf<YmcsReadClient>().not.toHaveProperty('request');
    expectTypeOf<YmcsReadClient>().not.toHaveProperty('createSite');
    expectTypeOf<YmcsReadClient>().toHaveProperty('listSites');
  });
});

describe('path segment guard', () => {
  it.each(['', '.', '..', 'a/b', 'a?b', 'a b'])('refuses %j', (v) => {
    expect(() => segment('id', v)).toThrow(/not a valid path segment/);
  });
  it('encodes what it accepts', () => {
    expect(segment('id', 'a:b')).toBe('a%3Ab');
  });
  it('never reaches the wire with a bad id', async () => {
    const { mock, c } = client();
    await expect(c.getSite('../admin')).rejects.toThrow();
    expect(mock.apiCalls()).toHaveLength(0);
  });
});

describe('GET reads', () => {
  it.each([
    ['getSite', ['site-0001'], '/v2/dm/sites/site-0001'],
    ['getDevice', ['dev-0001'], '/v2/dm/devices/dev-0001'],
    ['getDeviceConfigs', ['dev-0001'], '/v2/dm/devices/dev-0001/configs'],
    ['getDevicePart', ['dev-0001', 'part-1'], '/v2/dm/devices/dev-0001/parts/part-1'],
    ['listBoundAccounts', ['dev-0001'], '/v2/dm/devices/dev-0001/boundAccounts'],
    ['getNetworkInterfaces', ['dev-0001'], '/v2/dm/devices/dev-0001/networkInterfaces'],
    ['getDeviceConfig', ['cfg-1'], '/v2/dm/deviceConfigs/cfg-1'],
    ['getSiteConfig', ['cfg-1'], '/v2/dm/siteConfigs/cfg-1'],
    ['getGroupConfig', ['cfg-1'], '/v2/dm/groupConfigs/cfg-1'],
    ['getFirmware', ['fw-1'], '/v2/dm/firmwares/fw-1'],
    ['getDiagnosisStatus', ['diag-1'], '/v2/dm/diagnosis/diag-1/status'],
    ['getRpsDevice', ['rps-1'], '/v2/rps/devices/rps-1'],
  ] as const)('%s → GET %s', async (method, args, path) => {
    const { mock, c } = client({ routes: { [`GET ${path}`]: { body: { id: 'x' } } } });
    const out = await (c[method] as (...a: string[]) => Promise<unknown>)(...args);
    expect(out).toEqual({ id: 'x' });
    const call = mock.apiCalls()[0];
    expect(call.method).toBe('GET');
    expect(call.path).toBe(path);
    expect(call.body).toBeUndefined();
  });

  it('listModels sends deviceType as a query and accepts a bare array or {data}', async () => {
    const a = client({ routes: { 'GET /v2/dm/models': { body: [{ id: 'm1', name: 'SIP-T54W' }] } } });
    expect(await a.c.listModels(DeviceType.Phone)).toEqual([{ id: 'm1', name: 'SIP-T54W' }]);
    expect(a.mock.apiCalls()[0].query).toEqual({ deviceType: '1' });
    const b = client({ routes: { 'GET /v2/dm/models': { body: { data: [{ id: 'm2', name: 'MeetingBar' }] } } } });
    expect(await b.c.listModels(DeviceType.Room)).toEqual([{ id: 'm2', name: 'MeetingBar' }]);
  });

  it('resolveDeviceIds posts the MAC lookup shape', async () => {
    const { mock, c } = client({ routes: { 'POST /v2/dm/deviceId': { body: [{ key: '001565000001', deviceId: 'dev-0001' }] } } });
    const out = await c.resolveDeviceIds(['001565000001'], DeviceType.Phone);
    expect(out).toEqual([{ key: '001565000001', deviceId: 'dev-0001' }]);
    expect(mock.apiCalls()[0].body).toEqual({ deviceType: 1, deviceIds: ['001565000001'], deviceIdType: 'mac' });
  });
});

describe('POST list reads', () => {
  it.each([
    ['listSites', '/v2/dm/listSites'],
    ['listDeviceGroups', '/v2/dm/listDeviceGroups'],
    ['listSipAccounts', '/v2/dm/listAccounts'],
    ['listDeviceConfigs', '/v2/dm/listDeviceConfigs'],
    ['listSiteConfigs', '/v2/dm/listSiteConfigs'],
    ['listGroupConfigs', '/v2/dm/listGroupConfigs'],
    ['listFirmwares', '/v2/dm/listFirmwares'],
    ['listOfficialFirmwares', '/v2/dm/listOfficalFirmwares'],
    ['listAlarms', '/v2/dm/listAlarms'],
    ['listOperationLogs', '/v2/dm/listOpLogs'],
    ['listRpsDevices', '/v2/rps/listDevices'],
    ['listRpsServers', '/v2/rps/listServers'],
  ] as const)('%s → POST %s with the paging triple and filter', async (method, path) => {
    const { mock, c } = client({ routes: { [`POST ${path}`]: { body: page([{ id: "r1" }], 1) } } });
    const out = await (c[method] as (o: unknown) => Promise<unknown[]>)({ filter: { name: 'x' } });
    expect(out).toEqual([{ id: 'r1' }]);
    const call = mock.apiCalls()[0];
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ skip: 0, limit: 500, autoCount: true, filter: { name: 'x' } });
  });

  it('omits filter when none is given, and sends {} semantics rather than no body', async () => {
    const { mock, c } = client({ routes: { "POST /v2/dm/listSites": { body: page([], 0) } } });
    await c.listSites();
    expect(mock.apiCalls()[0].body).toEqual({ skip: 0, limit: 500, autoCount: true });
  });

  it('listDevices caps the page at 100 and pages by total', async () => {
    const rows = Array.from({ length: 230 }, (_, i) => ({ id: `dev-${i}`, mac: `0015650${String(i).padStart(5, '0')}` }));
    const { mock, c } = client({
      routes: { 'POST /v2/dm/listDevices': (call) => { const b = call.body as { skip: number; limit: number }; return { body: page(rows.slice(b.skip, b.skip + b.limit), 230, b.skip, b.limit) }; } },
    });
    const out = await c.listDevices({ filter: { siteId: 'site-0001' }, pageSize: 5000 });
    expect(out).toHaveLength(230);
    expect(mock.apiCalls().map((x) => (x.body as { limit: number; autoCount: boolean }))).toEqual([
      { skip: 0, limit: 100, autoCount: true, filter: { siteId: 'site-0001' } },
      { skip: 100, limit: 100, autoCount: false, filter: { siteId: 'site-0001' } },
      { skip: 200, limit: 100, autoCount: false, filter: { siteId: 'site-0001' } },
    ]);
  });

  it('device-scoped lists put the id in the path', async () => {
    const { mock, c } = client({ fallback: { body: page([], 0) } });
    await c.listDeviceParts('dev-0001');
    await c.listGroupDevices('grp-1', { limit: 3 });
    expect(mock.apiCalls().map((x) => x.path)).toEqual(['/v2/dm/devices/dev-0001/listParts', '/v2/dm/deviceGroups/grp-1/listDevices']);
    expect((mock.apiCalls()[1].body as { limit: number }).limit).toBe(3);
  });

  it('exposes the resolved base URL', () => {
    expect(client().c.baseUrl).toBe('https://us-api.ymcs.yealink.com');
  });
});
