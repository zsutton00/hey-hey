import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { BrowserToolsHttpController } from './http-mcp';
import { BrowserMcpAccess } from './browser-mcp-access';
import { BrowserTools } from '../../browser/browser-tools';
import { browserHarness } from '../../browser/__tests__/browser-test-support';
import { NOOP_LOGGER } from '../../server/logger';
import { RunLifecycleEvents } from '../../server/run-lifecycle-events';
import type { RunRegistry } from '../../run/run-registry';
import type { Run } from '../../run/run';

const harness = async () => {
  const browser = browserHarness();
  const lifecycle = new RunLifecycleEvents();
  const access = new BrowserMcpAccess(browser.manager, lifecycle, browser.tabs, NOOP_LOGGER);
  let run: Run | undefined = {
    projectId: 'p',
    activeTurn: { turnId: 't', platformMcpProxy: { active: true } },
  } as Run;
  access.bindRegistry({ get: () => run } as unknown as RunRegistry);
  const mount = (await access.mount('a', 'p', 't'))!;
  const controller = new BrowserToolsHttpController(
    access,
    new BrowserTools(browser.tabs, NOOP_LOGGER),
    NOOP_LOGGER,
  );
  const request = async (
    body: object,
    token = mount.token,
    headers: object = { host: '127.0.0.1:1234' },
  ) => {
    const json = vi.fn();
    const end = vi.fn();
    const status = vi.fn();
    const response = { json, end, status };
    status.mockReturnValue(response);
    await controller.handle(
      { body, params: { token }, headers } as unknown as Request,
      response as unknown as Response,
    );
    return { json, end, status };
  };
  return {
    ...browser,
    access,
    lifecycle,
    mount,
    request,
    evict: () => {
      run = undefined;
      lifecycle.publishRunRemoved('a', 'idle');
    },
    restore: () => {
      run = {
        projectId: 'p',
        activeTurn: { turnId: 't2', platformMcpProxy: { active: true } },
      } as Run;
    },
  };
};
const rpc = (method: string, params?: object) => ({
  jsonrpc: '2.0',
  id: 1,
  method,
  ...(params ? { params } : {}),
});

describe('browser HTTP MCP admission', () => {
  it('closes retained pages at shutdown even when their Run is idle-evicted', async () => {
    const h = await harness();
    await h.request(rpc('tools/call', { name: 'snapshot', arguments: {} }));
    h.evict();
    expect(h.pages[0]!.closed).toBe(false);
    await h.access.dispose();
    expect(h.pages[0]!.closed).toBe(true);
  });
  it('discovers tools without launching Chrome and returns standard initialization responses', async () => {
    const h = await harness();
    expect((await h.request(rpc('initialize'))).json).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ capabilities: { tools: {} } }) }),
    );
    expect((await h.request(rpc('tools/list'))).json).toHaveBeenCalledWith(
      expect.objectContaining({
        result: { tools: expect.arrayContaining([expect.objectContaining({ name: 'navigate' })]) },
      }),
    );
    await h.request(rpc('ping'));
    expect(
      (await h.request({ jsonrpc: '2.0', method: 'notifications/initialized' })).status,
    ).toHaveBeenCalledWith(202);
    expect(h.getBrowser).not.toHaveBeenCalled();
    await h.access.dispose();
  });
  it('keeps pages across idle eviction and remounting but revokes old credentials', async () => {
    const h = await harness();
    await h.request(
      rpc('tools/call', { name: 'navigate', arguments: { url: 'https://example.test' } }),
    );
    h.evict();
    expect(h.pages[0]!.closed).toBe(false);
    expect((await h.request(rpc('tools/list'))).status).toHaveBeenCalledWith(404);
    h.restore();
    const next = (await h.access.mount('a', 'p', 't2'))!;
    await h.request(rpc('tools/call', { name: 'snapshot', arguments: {} }), next.token);
    expect(h.pages).toHaveLength(1);
    expect(h.pages[0]!.currentUrl).toBe('https://example.test');
    h.lifecycle.publishRunRemoved('a');
    await h.access.dispose();
    expect(h.pages[0]!.closed).toBe(true);
  });
  it('rejects wrong capabilities, hostile origins/hosts and malformed input', async () => {
    const h = await harness();
    expect((await h.request(rpc('tools/list'), 'wrong')).status).toHaveBeenCalledWith(404);
    for (const headers of [
      { host: 'evil.test' },
      { host: '127.0.0.1:1234', origin: 'http://127.0.0.1:1234' },
      { host: 'localhost:1234', 'sec-fetch-site': 'cross-site' },
    ]) {
      expect(
        (await h.request(rpc('tools/list'), h.mount.token, headers)).status,
      ).toHaveBeenCalledWith(403);
    }
    expect((await h.request({ jsonrpc: '1.0', method: 'tools/list' })).status).toHaveBeenCalledWith(
      400,
    );
    expect(
      (
        await h.request(
          rpc('tools/call', { name: 'click', arguments: { selector: 'a', ref: 'e1' } }),
        )
      ).json,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: -32602 }) }),
    );
    expect(h.getBrowser).not.toHaveBeenCalled();
    await h.access.dispose();
  });
  it('omits mounts when disabled and rejects mounted calls after disablement/re-enablement', async () => {
    const h = await harness();
    await h.manager.setEnabled(false);
    expect(await h.access.mount('b', 'p', 't')).toBeUndefined();
    expect(
      (await h.request(rpc('tools/call', { name: 'snapshot', arguments: {} }))).status,
    ).toHaveBeenCalledWith(404);
    await h.manager.setEnabled(true);
    expect((await h.request(rpc('tools/list'))).status).toHaveBeenCalledWith(404);
    expect(h.getBrowser).not.toHaveBeenCalled();
    await h.access.dispose();
  });
});
