/**
 * Live tests against a real YMCS enterprise. Every tier self-skips unless its env vars are set, so
 * `pnpm test` stays offline for anyone without credentials.
 *
 *   YMCS_CLIENT_ID, YMCS_CLIENT_SECRET, and YMCS_REGION or YMCS_BASE_URL
 *       Read tier. Changes nothing.
 *   + YMCS_LIVE_WRITE=1
 *       Write tier. Creates a site, device group, SIP account, site and group config, and RPS
 *       server, all named `ylib-live-*`, then deletes them. Each step appears in the enterprise's
 *       operation log. A sweep at the start removes leftovers from a run that crashed.
 *   + YMCS_BENCH_MAC, YMCS_BENCH_SN, YMCS_BENCH_MODEL (a model name such as `SIP-T54W`)
 *       Device tier. DELETES that device from device management and RPS, adds it to a test site,
 *       binds an account, creates and pushes a device config, reboots it, starts diagnostics, and
 *       deletes it again. It does not put the device back. Use a phone that serves no one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeviceType, YmcsReadClient, YmcsWriteClient, type YmcsConfig, type YmcsRegion } from './index.js';

// `process` is typed loosely: the library builds with `types: []` so no Node types are in scope.
declare const process: { env: Record<string, string | undefined> };
const env = process.env;

const CREDS = Boolean(env.YMCS_CLIENT_ID && env.YMCS_CLIENT_SECRET && (env.YMCS_REGION || env.YMCS_BASE_URL));
const WRITE = CREDS && env.YMCS_LIVE_WRITE === '1';
const BENCH = WRITE && Boolean(env.YMCS_BENCH_MAC && env.YMCS_BENCH_SN && env.YMCS_BENCH_MODEL);

const cfg = (): YmcsConfig => ({
  clientId: env.YMCS_CLIENT_ID!,
  clientSecret: env.YMCS_CLIENT_SECRET!,
  ...(env.YMCS_BASE_URL ? { baseUrl: env.YMCS_BASE_URL } : { region: env.YMCS_REGION as YmcsRegion }),
});

const PREFIX = 'ylib-live-';
// RPS server names are capped at 20 characters, so the run tag stays short.
const TAG = PREFIX + Date.now().toString(36);
const T = 60_000;

describe.skipIf(!CREDS)('live: reads', () => {
  const r = CREDS ? new YmcsReadClient(cfg()) : (undefined as never);

  it('lists sites, devices, models and RPS servers', async () => {
    const sites = await r.listSites();
    expect(sites.some((s) => !s.parentId)).toBe(true);
    const devices = await r.listDevices({ limit: 5 });
    expect(Array.isArray(devices)).toBe(true);
    expect((await r.listModels(DeviceType.Phone)).length).toBeGreaterThan(0);
    expect(Array.isArray(await r.listRpsServers())).toBe(true);
  }, T);

  it('reports an unknown id as 400 code 900400', async () => {
    const err: any = await r.getSite('00000000000000000000000000000000').catch((e) => e);
    expect([err.status, err.code]).toEqual([400, '900400']);
  }, T);
});

describe.skipIf(!WRITE)('live: writes', () => {
  const r = WRITE ? new YmcsReadClient(cfg()) : (undefined as never);
  const w = WRITE ? new YmcsWriteClient(cfg()) : (undefined as never);
  let rootId = '';
  const made: { siteId?: string; groupId?: string; serverId?: string } = {};

  beforeAll(async () => {
    const sites = await r.listSites();
    rootId = sites.find((s) => !s.parentId)!.id;
    // Sweep leftovers from an earlier run: accounts and configs first, then what they hang off.
    const accounts = (await r.listSipAccounts()).filter((a) => a.username?.startsWith(PREFIX));
    if (accounts.length) await w.deleteSipAccounts(accounts.map((a) => a.id));
    for (const g of (await r.listDeviceGroups()).filter((g) => g.name.startsWith(PREFIX))) await w.deleteDeviceGroup(g.id);
    const servers = (await r.listRpsServers()).filter((s) => s.serverName.startsWith(PREFIX));
    if (servers.length) await w.deleteRpsServers(servers.map((s) => s.id));
    for (const s of sites.filter((s) => s.name.startsWith(PREFIX))) await w.deleteSite(s.id);
  }, 4 * T);

  afterAll(async () => {
    const quiet = (p: Promise<unknown>) => p.catch(() => undefined);
    if (made.groupId) await quiet(w.deleteDeviceGroup(made.groupId));
    if (made.serverId) await quiet(w.deleteRpsServers([made.serverId]));
    if (made.siteId) await quiet(w.deleteSite(made.siteId));
  }, 2 * T);

  it('site: create, update', async () => {
    const site = await w.createSite({ name: TAG, parentId: rootId });
    made.siteId = site.id;
    expect(site.name).toBe(TAG);
    await w.updateSite(site.id, { description: 'updated' });
    expect((await r.getSite(site.id)).description).toBe('updated');
  }, T);

  it('device group: create, update', async () => {
    const g = await w.createDeviceGroup({ name: TAG, deviceType: 1 });
    made.groupId = g.id;
    await w.updateDeviceGroup(g.id, { name: TAG + 'u', deviceType: 1 });
    expect((await r.listDeviceGroups()).find((x) => x.id === g.id)?.name).toBe(TAG + 'u');
  }, T);

  it('SIP account: create, full-body update, delete', async () => {
    const input = {
      registerName: TAG, username: TAG, password: 'not-a-real-password',
      sipServer1: { host: 'sip.example.com', port: 5060 }, siteId: made.siteId,
    };
    const a = await w.createSipAccount(input);
    await w.updateSipAccount(a.id, { ...input, sipServer1: { host: 'sip2.example.com', port: 5061 } });
    const row = (await r.listSipAccounts()).find((x) => x.id === a.id);
    expect(row?.serverAddress).toBe('sip2.example.com');
    expect(await w.deleteSipAccounts([a.id])).toMatchObject({ successCount: 1, failureCount: 0 });
  }, T);

  it('site and group configs: create, update, delete', async () => {
    const sc = await w.createSiteConfig({ name: TAG, siteId: made.siteId!, deviceType: 1, content: 'lang.wui=English' });
    await w.updateSiteConfig(sc.id, { name: TAG + 'u', siteId: made.siteId!, deviceType: 1 });
    expect(await w.deleteSiteConfigs([sc.id])).toMatchObject({ successCount: 1 });
    const gc = await w.createGroupConfig({ name: TAG, deviceGroupId: made.groupId!, deviceType: 1 });
    await w.updateGroupConfig(gc.id, { name: TAG + 'u', deviceGroupId: made.groupId!, deviceType: 1 });
    expect(await w.deleteGroupConfigs([gc.id])).toMatchObject({ successCount: 1 });
  }, T);

  it('RPS server: create, update (name and url together)', async () => {
    const s = await w.createRpsServer({ serverName: TAG, url: 'https://provisioning.example.com/cfg' });
    made.serverId = s.id;
    await w.updateRpsServer(s.id, { serverName: TAG, url: 'https://provisioning.example.com/cfg2' });
    expect((await r.getRpsServer(s.id)).url).toBe('https://provisioning.example.com/cfg2');
  }, T);

  describe.skipIf(!BENCH)('bench device', () => {
    const MAC = (env.YMCS_BENCH_MAC ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
    let deviceId = '';

    beforeAll(async () => {
      await w.deleteDevices([MAC], 1, { deviceIdType: 'mac' });
      await w.deleteRpsDevices([MAC], 'mac'); // a MAC already gone is a per-item failure, not an error
    }, 2 * T);

    afterAll(async () => {
      await w.deleteDevices([MAC], 1, { deviceIdType: 'mac' }).catch(() => undefined);
      await w.deleteRpsDevices([MAC], 'mac').catch(() => undefined);
    }, 2 * T);

    it('device management: create (reaches RPS through sync when enabled), update, group', async () => {
      const model = (await r.listModels(DeviceType.Phone)).find((m) => m.name === env.YMCS_BENCH_MODEL);
      expect(model, `model ${env.YMCS_BENCH_MODEL}`).toBeDefined();
      const d = await w.createDevice({ mac: MAC, sn: env.YMCS_BENCH_SN!, deviceType: 1, modelId: model!.id, name: TAG, siteId: made.siteId });
      deviceId = d.id;
      expect(await r.resolveDeviceIds([MAC], DeviceType.Phone)).toEqual([{ key: MAC, deviceId }]);
      await w.updateDevice(deviceId, { name: TAG + 'u' });
      expect((await r.getDevice(deviceId)).name).toBe(TAG + 'u');
      expect(await w.addDevicesToGroup(made.groupId!, [deviceId])).toMatchObject({ successCount: 1 });
      expect((await r.listGroupDevices(made.groupId!)).map((x) => x.id)).toContain(deviceId);
      expect(await w.removeDevicesFromGroup(made.groupId!, [deviceId])).toMatchObject({ successCount: 1 });
    }, 2 * T);

    it('accounts: bind and unbind', async () => {
      const a = await w.createSipAccount({
        registerName: TAG, username: TAG, password: 'not-a-real-password',
        sipServer1: { host: 'sip.example.com', port: 5060 }, siteId: made.siteId,
      });
      try {
        expect(await w.bindAccounts(deviceId, [{ accountId: a.id, lineId: 1, accountType: 0 }])).toMatchObject({ successCount: 1 });
        expect((await r.listBoundAccounts(deviceId)).map((b) => b.accountId)).toEqual([a.id]);
        expect(await w.unbindAccounts(deviceId, [a.id])).toMatchObject({ successCount: 1 });
      } finally {
        await w.deleteSipAccounts([a.id]);
      }
    }, 2 * T);

    it('device config: one per device, pushed, deleted', async () => {
      const dc = await w.createDeviceConfig({ deviceId, content: 'lang.wui=English', autoPush: false });
      expect((await r.getDeviceConfig(dc.id)).content).toContain('lang.wui=English');
      const dup: any = await w.createDeviceConfig({ deviceId, content: 'lang.gui=English' }).catch((e) => e);
      expect(dup.code).toBe('800003');
      await w.pushDeviceConfig(dc.id);
      expect(await w.deleteDeviceConfigs([dc.id])).toMatchObject({ successCount: 1 });
    }, T);

    it('commands and diagnostics are accepted', async () => {
      expect(await w.rebootDevices([deviceId], 1)).toMatchObject({ successCount: 1 });
      expect(await w.rebootDeviceParts(deviceId)).toMatchObject({ failureCount: 0 });
      const cap = await w.captureScreen(deviceId);
      expect(cap.diagnosisId).toBeTruthy();
      expect((await r.getDiagnosisStatus(cap.diagnosisId!)).status).toBeTruthy();
      expect((await w.ping(deviceId, 'example.com', { times: 1 })).diagnosisId).toBeTruthy();
    }, 2 * T);

    it('RPS: single create, update, delete by id', async () => {
      await w.deleteRpsDevices([MAC], 'mac'); // clear the copy sync made from the device-management create
      const d = await w.createRpsDevice({ mac: MAC, sn: env.YMCS_BENCH_SN, serverId: made.serverId, remark: TAG });
      await w.updateRpsDevice(d.id, { remark: TAG + 'u' });
      expect((await r.getRpsDevice(d.id)).remark).toBe(TAG + 'u');
      expect(await w.deleteRpsDevices([d.id], 'id')).toMatchObject({ successCount: 1 });
    }, 2 * T);
  });
});
