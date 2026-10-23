import { describe, expect, it, vi } from 'vitest';
import { BrowserTools } from '../browser-tools';
import { browserCallSchema } from '../browser-tool-schemas';
import { NOOP_LOGGER } from '../../server/logger';
import { browserHarness, FakePage } from './browser-test-support';

describe('BrowserTools', () => {
  it('bounds hung evaluation and makes a fresh page available without blocking another Run', async () => {
    const h = browserHarness();
    const tools = new BrowserTools(h.tabs, NOOP_LOGGER);
    await h.tabs.use('a', 'p', async () => {});
    h.pages[0]!.evaluate.mockImplementation(() => new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const pending = tools.execute(
        'a',
        'p',
        { name: 'evaluate', arguments: { expression: 'new Promise(() => {})' } },
        () => true,
      );
      await vi.advanceTimersByTimeAsync(10_001);
      expect((await pending).isError).toBe(true);
      expect(
        (await tools.execute('b', 'p', { name: 'snapshot', arguments: {} }, () => true)).isError,
      ).toBeUndefined();
      expect(
        (await tools.execute('a', 'p', { name: 'snapshot', arguments: {} }, () => true)).isError,
      ).toBeUndefined();
      expect(h.pages).toHaveLength(3);
    } finally {
      vi.useRealTimers();
      await h.tabs.dispose();
    }
  });
  it('executes selector/ref actions, snapshots, image screenshots and JSON evaluation', async () => {
    const h = browserHarness();
    const tools = new BrowserTools(h.tabs, NOOP_LOGGER);
    const call = (name: string, args: object = {}) =>
      tools.execute('a', 'p', browserCallSchema.parse({ name, arguments: args }), () => true);
    await call('navigate', { url: 'https://example.test' });
    await call('snapshot');
    await call('click', { ref: 'e2' });
    expect(h.pages[0]!.getByRef).toHaveBeenCalledWith('e2');
    expect((await call('click', { ref: 'e2' })).isError).toBe(true);
    await call('type', { selector: 'input', text: 'hello' });
    expect(h.pages[0]!.fill).toHaveBeenCalledWith('hello', { timeout: 10_000 });
    expect((await call('screenshot')).content[0]).toEqual({
      type: 'image',
      data: Buffer.from('png').toString('base64'),
      mimeType: 'image/png',
    });
    expect((await call('evaluate', { expression: '({ok:true})' })).content[0]).toEqual({
      type: 'text',
      text: '{"ok":true}',
    });
    await h.tabs.dispose();
  });
  it('rejects foreign page IDs, and console buffers belong to their page family', async () => {
    const h = browserHarness();
    const tools = new BrowserTools(h.tabs, NOOP_LOGGER);
    const other = await h.tabs.use('b', 'p', async (_, selected) => selected.id);
    await h.tabs.use('a', 'p', async () => {});
    expect(
      (
        await tools.execute(
          'a',
          'p',
          { name: 'select_page', arguments: { pageId: other } },
          () => true,
        )
      ).isError,
    ).toBe(true);
    const popup = new FakePage();
    h.pages[1]!.emit('popup', popup.asPage());
    for (let i = 0; i < 120; i++)
      popup.emit('console', { type: () => 'log', text: () => String(i) });
    const selectedId = await h.tabs.use(
      'a',
      'p',
      async (family) => [...family.pages.values()][1]!.id,
    );
    await tools.execute(
      'a',
      'p',
      { name: 'select_page', arguments: { pageId: selectedId } },
      () => true,
    );
    const messages = await tools.execute(
      'a',
      'p',
      { name: 'console_messages', arguments: {} },
      () => true,
    );
    expect(messages.content[0]).toEqual({
      type: 'text',
      text: JSON.stringify(Array.from({ length: 100 }, (_, index) => `log: ${index + 20}`)),
    });
    expect(
      (await tools.execute('b', 'p', { name: 'console_messages', arguments: {} }, () => true))
        .content[0],
    ).toEqual({ type: 'text', text: '[]' });
    await h.tabs.dispose();
  });
  it('invalidates refs on navigation and isolates a failed tool from another Run', async () => {
    const h = browserHarness();
    const tools = new BrowserTools(h.tabs, NOOP_LOGGER);
    await tools.execute('a', 'p', { name: 'snapshot', arguments: {} }, () => true);
    await h.pages[0]!.goto('https://example.test');
    expect(
      (await tools.execute('a', 'p', { name: 'click', arguments: { ref: 'e1' } }, () => true))
        .isError,
    ).toBe(true);
    h.pages[0]!.goto.mockRejectedValue(new Error('private URL'));
    expect(
      (
        await tools.execute(
          'a',
          'p',
          { name: 'navigate', arguments: { url: 'https://example.test' } },
          () => true,
        )
      ).isError,
    ).toBe(true);
    expect(
      (await tools.execute('b', 'p', { name: 'snapshot', arguments: {} }, () => true)).isError,
    ).toBeUndefined();
    await h.tabs.dispose();
  });
  it('rejects malformed arguments and browser/context/path overrides', () => {
    for (const call of [
      { name: 'click', arguments: {} },
      { name: 'click', arguments: { ref: 'e1', selector: 'button' } },
      { name: 'screenshot', arguments: { path: '/tmp/image.png' } },
      { name: 'navigate', arguments: { url: 'https://example.test', projectId: 'foreign' } },
      { name: 'select_page', arguments: { pageId: 'foreign' } },
    ])
      expect(browserCallSchema.safeParse(call).success).toBe(false);
  });
});
