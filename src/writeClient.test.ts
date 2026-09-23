import { describe, expect, it } from 'vitest';
import { YmcsWriteClient } from './writeClient.js';
import { CREDS, mockFetch, page, type MockFetchOptions } from './testkit.js';

function client(opts: MockFetchOptions = {}) {
  const mock = mockFetch(opts);
  return { mock, w: new YmcsWriteClient({ ...CREDS, fetchImpl: mock.fetchImpl }) };
}

const DEV = { mac: '001565000001', sn: 'SN000000000001', deviceType: 1 as const, modelId: 'model-t54w' };
const SIP = { registerName: '101', username: '101', password: 'pw', sipServer1: { host: 'sip.example.com', port: 5060 } };
const RPS_SERVER = { serverName: 'ndp', url: 'https://ndp.example.com/cfg' };

describe('creates (POST, return the server body)', () => {
  it.each([
    ['createSite', [{ name: 'Branch', parentId: 'site-root' }], '/v2/dm/sites', { name: 'Branch', parentId: 'site-root' }],
    ['createDevice', [DEV], '/v2/dm/devices', DEV],
    ['addDevices', [[DEV]], '/v2/dm/addDevices', [DEV]],
    ['addDevicesByMac', [[{ mac: DEV.mac, deviceType: 1, modelId: DEV.modelId }]], '/v2/dm/addDevicesByMac', [{ mac: DEV.mac, deviceType: 1, modelId: DEV.modelId }]],
    ['deleteDevices', [['dev-1', 'dev-2'], 1], '/v2/dm/delDevices', { deviceIds: ['dev-1', 'dev-2'], deviceType: 1 }],
    ['deleteDevices', [['001565000001'], 1, { deviceIdType: 'mac' }], '/v2/dm/delDevices', { deviceIds: ['001565000001'], deviceType: 1, deviceIdType: 'mac' }],
    ['rebootDevices', [['dev-1'], 1], '/v2/dm/device/reboot', { deviceIds: ['dev-1'], deviceType: 1 }],
    ['resetDevices', [['dev-1'], 3], '/v2/dm/device/reset', { deviceIds: ['dev-1'], deviceType: 3 }],
    ['rebootDeviceParts', ['dev-1'], '/v2/dm/devices/dev-1/parts/reboot', {}],
    ['rebootDeviceParts', ['dev-1', ['p1']], '/v2/dm/devices/dev-1/parts/reboot', { partIds: ['p1'] }],
    ['resetDeviceParts', ['dev-1', ['p1']], '/v2/dm/devices/dev-1/parts/reset', { partIds: ['p1'] }],
    ['bindAccounts', ['dev-1', [{ accountId: 'acc-1', lineId: 1, accountType: 0 }]], '/v2/dm/devices/dev-1/bindAccounts', [{ accountId: 'acc-1', lineId: 1, accountType: 0 }]],
    ['unbindAccounts', ['dev-1', ['acc-1']], '/v2/dm/devices/dev-1/unbindAccounts', { accountIds: ['acc-1'] }],
    ['createDeviceGroup', [{ name: 'Lobby', deviceType: 1 }], '/v2/dm/deviceGroups', { name: 'Lobby', deviceType: 1 }],
    ['addDevicesToGroup', ['grp-1', ['dev-1']], '/v2/dm/deviceGroups/grp-1/addDevices', { deviceIds: ['dev-1'] }],
    ['removeDevicesFromGroup', ['grp-1', ['dev-1']], '/v2/dm/deviceGroups/grp-1/delDevices', { deviceIds: ['dev-1'] }],
    ['createSipAccount', [SIP], '/v2/dm/sipAccounts', SIP],
    ['deleteSipAccounts', [['acc-1']], '/v2/dm/delAccounts', { accountIds: ['acc-1'] }],
    ['createDeviceConfig', [{ deviceId: 'dev-1', content: 'lang.wui=English', autoPush: false }], '/v2/dm/deviceConfigs', { deviceId: 'dev-1', content: 'lang.wui=English', autoPush: false }],
    ['deleteDeviceConfigs', [['cfg-1']], '/v2/dm/delDeviceConfigs', { configIds: ['cfg-1'] }],
    ['pushDeviceConfig', ['cfg-1'], '/v2/dm/deviceConfigs/cfg-1/push', {}],
    ['createSiteConfig', [{ name: 'c', siteId: 's', deviceType: 1 }], '/v2/dm/siteConfigs', { name: 'c', siteId: 's', deviceType: 1 }],
    ['deleteSiteConfigs', [['cfg-1']], '/v2/dm/delSiteConfigs', { configIds: ['cfg-1'] }],
    ['pushSiteConfig', ['cfg-1'], '/v2/dm/siteConfigs/cfg-1/push', {}],
    ['createGroupConfig', [{ name: 'c', deviceGroupId: 'g', deviceType: 1 }], '/v2/dm/groupConfigs', { name: 'c', deviceGroupId: 'g', deviceType: 1 }],
    ['deleteGroupConfigs', [['cfg-1']], '/v2/dm/delGroupConfigs', { configIds: ['cfg-1'] }],
    ['pushGroupConfig', ['cfg-1'], '/v2/dm/groupConfigs/cfg-1/push', {}],
    ['pushFirmware', ['fw-1', ['dev-1'], 1], '/v2/dm/firmwares/fw-1/push', { deviceIds: ['dev-1'], deviceType: 1 }],
    ['pushOfficialFirmware', ['ofw-1', ['dev-1'], 1], '/v2/dm/officalFirmwares/ofw-1/push', { deviceIds: ['dev-1'], deviceType: 1 }],
    ['createRpsDevice', [{ mac: DEV.mac, sn: DEV.sn, serverId: 'srv-1' }], '/v2/rps/devices', { mac: DEV.mac, sn: DEV.sn, serverId: 'srv-1' }],
    ['addRpsDevices', [[{ mac: DEV.mac }]], '/v2/rps/addDevices', [{ mac: DEV.mac }]],
    ['deleteRpsDevices', [[DEV.mac], 'mac'], '/v2/rps/delDevices', { deviceIdType: 'mac', deviceIds: [DEV.mac] }],
    ['deleteRpsServers', [['srv-1']], '/v2/rps/delServers', { serverIds: ['srv-1'] }],
    ['createRpsServer', [RPS_SERVER], '/v2/rps/servers', RPS_SERVER],
  ] as const)('%s → POST %s', async (method, args, path, body) => {
    const { mock, w } = client({ routes: { [`POST ${path}`]: { body: { id: 'new-1' } } } });
    const out = await (w[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    expect(out).toEqual({ id: 'new-1' });
    const call = mock.apiCalls()[0];
    expect(call.method).toBe('POST');
    expect(call.path).toBe(path);
    expect(call.body).toEqual(body);
  });

  it('a bodyless push still puts {} on the wire', async () => {
    const { mock, w } = client();
    await w.pushDeviceConfig('cfg-1');
    expect(mock.apiCalls()[0].body).toEqual({});
    expect(mock.apiCalls()[0].headers['Content-Type']).toBe('application/json');
  });
});

describe('updates (PATCH, 204, return void)', () => {
  it.each([
    ['updateSite', ['site-1', { name: 'n' }], '/v2/dm/sites/site-1', { name: 'n' }],
    ['updateDevice', ['dev-1', { siteId: 'site-2' }], '/v2/dm/devices/dev-1', { siteId: 'site-2' }],
    ['updateDeviceGroup', ['grp-1', { name: 'g', deviceType: 1 }], '/v2/dm/deviceGroups/grp-1', { name: 'g', deviceType: 1 }],
    ['updateSipAccount', ['acc-1', SIP], '/v2/dm/sipAccounts/acc-1', SIP],
    ['updateSiteConfig', ['cfg-1', { name: 'c', siteId: 's', deviceType: 1 }], '/v2/dm/siteConfigs/cfg-1', { name: 'c', siteId: 's', deviceType: 1 }],
    ['updateGroupConfig', ['cfg-1', { name: 'c', deviceGroupId: 'g', deviceType: 1 }], '/v2/dm/groupConfigs/cfg-1', { name: 'c', deviceGroupId: 'g', deviceType: 1 }],
    ['updateRpsDevice', ['rps-1', { serverId: 'srv-2' }], '/v2/rps/devices/rps-1', { serverId: 'srv-2' }],
    ['updateRpsServer', ['srv-1', RPS_SERVER], '/v2/rps/servers/srv-1', RPS_SERVER],
  ] as const)('%s → PATCH %s', async (method, args, path, body) => {
    const { mock, w } = client({ routes: { [`PATCH ${path}`]: { status: 204 } } });
    const out = await (w[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    expect(out).toBeUndefined();
    const call = mock.apiCalls()[0];
    expect(call.method).toBe('PATCH');
    expect(call.path).toBe(path);
    expect(call.body).toEqual(body);
  });

  it.each(['updateSite', 'updateDevice', 'updateRpsDevice'] as const)('%s refuses an empty patch before the wire', async (method) => {
    const { mock, w } = client();
    await expect((w[method] as (id: string, p: object) => Promise<void>)('x-1', {})).rejects.toThrow(/at least one field/);
    expect(mock.apiCalls()).toHaveLength(0);
  });
});

describe('deletes', () => {
  it.each([
    ['deleteSite', ['site-1'], '/v2/dm/sites/site-1'],
    ['deleteDevice', ['dev-1'], '/v2/dm/devices/dev-1'],
    ['deleteDeviceGroup', ['grp-1'], '/v2/dm/deviceGroups/grp-1'],
  ] as const)('%s → DELETE %s, no body, void', async (method, args, path) => {
    const { mock, w } = client({ routes: { [`DELETE ${path}`]: { status: 204 } } });
    expect(await (w[method] as (...a: string[]) => Promise<void>)(...args)).toBeUndefined();
    const call = mock.apiCalls()[0];
    expect(call.method).toBe('DELETE');
    expect(call.path).toBe(path);
    expect(call.body).toBeUndefined();
  });
});

describe('diagnosis (PUT)', () => {
  it.each([
    ['startPacketCapture', ['dev-1'], '/v2/dm/devices/dev-1/startPacketCapture', {}],
    ['startPacketCapture', ['dev-1', { duration: 60 }], '/v2/dm/devices/dev-1/startPacketCapture', { duration: 60 }],
    ['stopPacketCapture', ['dev-1', 'diag-1'], '/v2/dm/devices/dev-1/stopPacketCapture', { diagnosisId: 'diag-1' }],
    ['captureScreen', ['dev-1'], '/v2/dm/devices/dev-1/captureScreen', {}],
    ['exportSyslog', ['dev-1'], '/v2/dm/devices/dev-1/exportSyslog', {}],
    ['exportConfig', ['dev-1'], '/v2/dm/devices/dev-1/exportConfig', {}],
    ['ping', ['dev-1', 'gw.example.com'], '/v2/dm/devices/dev-1/ping', { host: 'gw.example.com' }],
    ['traceroute', ['dev-1', 'gw.example.com', { maxHops: 5 }], '/v2/dm/devices/dev-1/traceroute', { host: 'gw.example.com', maxHops: 5 }],
  ] as const)('%s → PUT %s', async (method, args, path, body) => {
    const { mock, w } = client({ routes: { [`PUT ${path}`]: { body: { diagnosisId: 'diag-9' } } } });
    const out = await (w[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    expect(out).toEqual({ diagnosisId: 'diag-9' });
    const call = mock.apiCalls()[0];
    expect(call.method).toBe('PUT');
    expect(call.path).toBe(path);
    expect(call.body).toEqual(body);
  });
});

describe('passthrough', () => {
  it('request sends any verb and distinguishes no-body from {}', async () => {
    const { mock, w } = client({ routes: { 'GET /v2/dm/anything': { body: { ok: 1 } } } });
    expect(await w.request('GET', '/v2/dm/anything', { query: { a: 1 } })).toEqual({ ok: 1 });
    await w.request('POST', 'v2/dm/listQoes', { body: {} });
    const [a, b] = mock.apiCalls();
    expect(a.body).toBeUndefined();
    expect(a.query).toEqual({ a: '1' });
    expect(b.path).toBe('/v2/dm/listQoes');
    expect(b.body).toEqual({});
  });

  it('requestAllItems pages any list endpoint with a custom data key and cap', async () => {
    const { mock, w } = client({
      routes: { 'POST /v2/dm/listQoes': (c) => { const b = c.body as { skip: number }; return { body: { total: 3, items: b.skip === 0 ? [{ i: 1 }, { i: 2 }] : [{ i: 3 }] } }; } },
    });
    const out = await w.requestAllItems('/v2/dm/listQoes', { dataKey: 'items', maxPageSize: 2, filter: { mac: '0015' } });
    expect(out).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }]);
    expect(mock.apiCalls().map((c) => c.body)).toEqual([
      { skip: 0, limit: 2, autoCount: true, filter: { mac: '0015' } },
      { skip: 2, limit: 2, autoCount: false, filter: { mac: '0015' } },
    ]);
  });

  it('refuses a path-traversing id', async () => {
    const { mock, w } = client();
    await expect(w.deleteSite('../sites')).rejects.toThrow(/path segment/);
    expect(mock.apiCalls()).toHaveLength(0);
  });
});

describe('sanity: the mock page helper', () => {
  it('shapes a page', () => {
    expect(page([1], 5, 2, 1)).toEqual({ skip: 2, limit: 1, total: 5, data: [1] });
  });
});
