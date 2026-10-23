import { describe, expect, it, vi } from 'vitest';
import { browserHarness, FakePage } from './browser-test-support';
import { StagedBrowserTabNotFoundError } from '../run-tabs';

describe('RunTabs', () => {
  it('launches lazily, preserves a Run across calls, and isolates concurrent Runs', async () => {
    const h = browserHarness();
    expect(h.getBrowser).not.toHaveBeenCalled();
    const [first, other] = await Promise.all([
      h.tabs.use('a', 'project', async (_, selected) => selected),
      h.tabs.use('b', 'project', async (_, selected) => selected),
    ]);
    expect(first.page).not.toBe(other.page);
    expect(await h.tabs.use('a', 'project', async (_, selected) => selected)).toBe(first);
    await h.tabs.dispose();
    expect(h.pages.every((page) => page.closed)).toBe(true);
  });
  it('adopts recursive popups without exposing another Run’s pages', async () => {
    const h = browserHarness();
    await h.tabs.use('a', 'p', async () => {});
    await h.tabs.use('b', 'p', async () => {});
    const popup = new FakePage();
    const child = new FakePage();
    h.pages[0]!.emit('popup', popup.asPage());
    popup.emit('popup', child.asPage());
    expect(await h.tabs.use('a', 'p', async (family) => family.pages.size)).toBe(3);
    expect(await h.tabs.use('b', 'p', async (family) => family.pages.size)).toBe(1);
    await h.tabs.remove('a');
    expect(popup.closed && child.closed).toBe(true);
    expect(h.pages[1]!.closed).toBe(false);
    await h.tabs.dispose();
  });
  it('replaces a manually closed selection and disconnected browser with blank pages', async () => {
    const h = browserHarness();
    await h.tabs.use('a', 'p', async () => {});
    await h.pages[0]!.goto('https://example.test');
    await h.pages[0]!.close();
    await h.tabs.use('a', 'p', async () => {});
    expect(h.pages[1]!.currentUrl).toBe('about:blank');
    h.browser.emit('disconnected');
    await h.tabs.use('a', 'p', async () => {});
    expect(h.pages[1]!.closed).toBe(true);
    expect(h.pages[2]!.currentUrl).toBe('about:blank');
    await h.tabs.dispose();
  });
  it('serializes a Run but leaves another Run usable after failure', async () => {
    const h = browserHarness();
    const order: number[] = [];
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = h.tabs.use('a', 'p', async () => {
      order.push(1);
      await gate;
      throw new Error('bad page');
    });
    const rejected = expect(first).rejects.toThrow('bad page');
    const second = h.tabs.use('a', 'p', async () => {
      order.push(2);
    });
    await h.tabs.use('b', 'p', async () => {
      order.push(3);
    });
    expect(order).toEqual([1, 3]);
    finish();
    await rejected;
    await second;
    expect(order).toEqual([1, 3, 2]);
    await h.tabs.dispose();
  });
  it('closes pending creation on removal and rejects late popups', async () => {
    const h = browserHarness();
    const pending = new FakePage();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.newPage.mockImplementationOnce(async () => {
      await gate;
      return pending.asPage();
    });
    const creation = h.tabs.use('a', 'p', async () => {});
    const rejected = expect(creation).rejects.toThrow('expired');
    await vi.waitFor(() => expect(h.newPage).toHaveBeenCalled());
    const removal = h.tabs.remove('a');
    release();
    await rejected;
    await removal;
    expect(pending.closed).toBe(true);
    await h.tabs.use('b', 'p', async () => {});
    const parent = h.pages[0]!;
    await h.tabs.remove('b');
    const popup = new FakePage();
    parent.emit('popup', popup.asPage());
    await vi.waitFor(() => expect(popup.closed).toBe(true));
    await h.tabs.dispose();
  });
  it('isolates cleanup failures and rejects expired access before creating a page', async () => {
    const h = browserHarness();
    await h.tabs.use('a', 'p', async () => {});
    await h.tabs.use('b', 'p', async () => {});
    h.pages[0]!.close.mockRejectedValue(new Error('cannot close'));
    await h.tabs.remove('a');
    await h.tabs.use('b', 'p', async () => {});
    await expect(
      h.tabs.use(
        'c',
        'p',
        async () => {},
        () => false,
      ),
    ).rejects.toThrow('expired');
    expect(h.pages).toHaveLength(2);
    await h.tabs.dispose();
  });
  describe('staged tabs', () => {
    it('keeps a staged tab outside every Run until a starting Run adopts it as its selected page', async () => {
      const h = browserHarness();
      const stagedTabId = await h.tabs.stage('p', 'https://example.test/setup');
      const staged = h.pages[0]!;
      expect(staged.currentUrl).toBe('https://example.test/setup');
      await h.tabs.use('other', 'p', async (family) => {
        expect([...family.pages.values()].map((owned) => owned.page)).not.toContain(
          staged.asPage(),
        );
      });
      await staged.goto('https://example.test/ready');

      await h.tabs.adoptStaged('a', 'p', stagedTabId);

      expect(h.pages).toHaveLength(2);
      expect(await h.tabs.use('a', 'p', async (_, selected) => selected.page)).toBe(
        staged.asPage(),
      );
      expect(h.pages).toHaveLength(2);
      expect(h.tabs.notices.pending('a')).toMatchObject({ url: 'https://example.test/ready' });
      await h.tabs.dispose();
    });

    it('treats a retried adoption by the same Run as done and refuses it to another Run', async () => {
      const h = browserHarness();
      const stagedTabId = await h.tabs.stage('p', 'about:blank');
      await h.tabs.adoptStaged('a', 'p', stagedTabId);
      h.tabs.notices.delivered('a', h.tabs.notices.pending('a')!.id);
      await h.tabs.adoptStaged('a', 'p', stagedTabId);
      expect(h.tabs.notices.pending('a')).toBeNull();
      await expect(h.tabs.adoptStaged('b', 'p', stagedTabId)).rejects.toBeInstanceOf(
        StagedBrowserTabNotFoundError,
      );
      await h.tabs.dispose();
    });

    it('rejects adoption of a closed, unknown, other-project or disconnected staged tab', async () => {
      const h = browserHarness();
      const closed = await h.tabs.stage('p', 'about:blank');
      await h.pages[0]!.close();
      await expect(h.tabs.adoptStaged('a', 'p', closed)).rejects.toBeInstanceOf(
        StagedBrowserTabNotFoundError,
      );
      await expect(h.tabs.adoptStaged('a', 'p', 'unknown')).rejects.toBeInstanceOf(
        StagedBrowserTabNotFoundError,
      );
      const elsewhere = await h.tabs.stage('p', 'about:blank');
      await expect(h.tabs.adoptStaged('b', 'other', elsewhere)).rejects.toBeInstanceOf(
        StagedBrowserTabNotFoundError,
      );
      const restarted = await h.tabs.stage('p', 'about:blank');
      h.connected.mockReturnValue(false);
      await expect(h.tabs.adoptStaged('c', 'p', restarted)).rejects.toBeInstanceOf(
        StagedBrowserTabNotFoundError,
      );
      expect(h.tabs.notices.pending('a')).toBeNull();
      await h.tabs.dispose();
    });

    it('leaves an unadopted staged tab open and opens none when Shared Browser is off', async () => {
      const h = browserHarness();
      await h.tabs.stage('p', 'about:blank');
      await h.tabs.dispose();
      expect(h.pages[0]!.closed).toBe(false);

      const off = browserHarness();
      await off.manager.setEnabled(false);
      await expect(off.tabs.stage('p', 'about:blank')).rejects.toThrow('turned off');
      expect(off.pages).toHaveLength(0);
    });
  });
});
