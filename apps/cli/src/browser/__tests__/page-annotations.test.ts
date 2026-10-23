import { describe, expect, it } from 'vitest';
import { browserHarness, FakePage } from './browser-test-support';
import { MOCKUP_SERVE_HEADER } from '../mockup-serves';
import { formatBrowserAnnotations } from '../page-annotations';

const add = (selector: string, note = '') => ({
  op: 'add',
  annotation: { selector, role: 'button', text: 'Save changes', note },
});

const twoRuns = async () => {
  const h = browserHarness();
  await h.tabs.use('a', 'p', async () => {});
  await h.tabs.use('b', 'p', async () => {});
  return { h, pageA: h.pages[0]!, pageB: h.pages[1]! };
};

/** A main-frame navigation response, as the page's tab sees it. */
const navigationResponse = (page: FakePage, url: string, serveId?: string) =>
  page.emit('response', {
    request: () => ({ isNavigationRequest: () => true, frame: () => page }),
    headers: () => (serveId ? { [MOCKUP_SERVE_HEADER]: serveId } : {}),
    url: () => url,
  });

describe('PageAnnotations', () => {
  it('installs one binding and overlay for the shared context', async () => {
    const { h } = await twoRuns();
    await h.tabs.use('c', 'p', async () => {});
    expect(h.exposeBinding).toHaveBeenCalledTimes(1);
    expect(h.addInitScript).toHaveBeenCalledTimes(1);
    expect(h.addInitScript.mock.calls[0]![0].content).toContain('__heyheyAnnotate');
    await h.tabs.dispose();
  });

  it('attributes annotations to the Run that owns the calling page, with the page’s URL', async () => {
    const { h, pageA, pageB } = await twoRuns();
    await pageA.goto('http://localhost:3000/settings');
    const view = await h.annotate(pageA, add('[data-testid="save-btn"]', 'misaligned'));
    expect(view).toEqual({
      total: 1,
      annotations: [
        {
          id: expect.any(String),
          number: 1,
          selector: '[data-testid="save-btn"]',
          note: 'misaligned',
        },
      ],
    });
    expect(h.tabs.annotations.pending('a')).toEqual([
      {
        id: expect.any(String),
        url: 'http://localhost:3000/settings',
        selector: '[data-testid="save-btn"]',
        role: 'button',
        text: 'Save changes',
        note: 'misaligned',
        elementId: null,
        mockup: null,
      },
    ]);
    expect(h.tabs.annotations.pending('b')).toEqual([]);
    expect(await h.annotate(pageB, { op: 'list' })).toEqual({ total: 0, annotations: [] });
    await h.tabs.dispose();
  });

  it('attributes popups to their opener’s Run', async () => {
    const { h, pageA } = await twoRuns();
    const popup = new FakePage();
    pageA.emit('popup', popup.asPage());
    await h.annotate(popup, add('#save'));
    expect(h.tabs.annotations.pending('a')).toHaveLength(1);
    expect(h.tabs.annotations.pending('b')).toHaveLength(0);
    await h.tabs.dispose();
  });

  it('rejects pages no Run owns, child frames, a wrong nonce and unknown fields', async () => {
    const { h, pageA } = await twoRuns();
    const stranger = new FakePage();
    await expect(h.annotate(stranger, { op: 'list' })).rejects.toThrow('Run pages');
    await expect(h.annotate(pageA, add('#x'), { url: () => 'https://ads.test' })).rejects.toThrow(
      'Run pages',
    );
    await expect(h.annotate(pageA, { op: 'list', extra: true })).rejects.toThrow('Invalid');
    const binding = h.exposeBinding.mock.calls[0]![1];
    expect(() =>
      binding(
        { page: pageA.asPage(), frame: pageA as never },
        { nonce: 'forged', message: { op: 'clear' } },
      ),
    ).toThrow('Invalid');
    expect(h.tabs.annotations.pending('a')).toEqual([]);
    await h.tabs.dispose();
  });

  it('restores markers after a reload and keeps them pending across navigation', async () => {
    const { h, pageA } = await twoRuns();
    await pageA.goto('https://app.test/one#top');
    await h.annotate(pageA, add('#first'));
    await pageA.goto('https://app.test/two');
    await h.annotate(pageA, add('#second'));
    await pageA.goto('https://app.test/one');
    const view = await h.annotate(pageA, { op: 'list' });
    expect(view).toEqual({
      total: 2,
      annotations: [expect.objectContaining({ number: 1, selector: '#first' })],
    });
    expect(h.tabs.annotations.pending('a').map((entry) => entry.selector)).toEqual([
      '#first',
      '#second',
    ]);
    await h.tabs.dispose();
  });

  it('edits, removes and clears through the binding and tells the Run’s other pages', async () => {
    const { h, pageA } = await twoRuns();
    const popup = new FakePage();
    pageA.emit('popup', popup.asPage());
    popup.evaluate.mockClear();
    await h.annotate(pageA, add('#one'));
    await h.annotate(pageA, add('#two'));
    expect(popup.evaluate).toHaveBeenCalledTimes(2);
    const [one, two] = h.tabs.annotations.pending('a');
    await h.annotate(pageA, { op: 'update', id: one!.id, note: 'wrong colour' });
    await h.annotate(pageA, { op: 'remove', id: two!.id });
    expect(h.tabs.annotations.pending('a')).toEqual([
      expect.objectContaining({ selector: '#one', note: 'wrong colour' }),
    ]);
    await h.annotate(pageA, { op: 'clear' });
    expect(h.tabs.annotations.pending('a')).toEqual([]);
    await h.tabs.dispose();
  });

  it('clears only delivered annotations and asks every Run page to redraw', async () => {
    const { h, pageA } = await twoRuns();
    await h.annotate(pageA, add('#one'));
    const delivered = h.tabs.annotations.pending('a');
    await h.annotate(pageA, add('#late'));
    pageA.evaluate.mockClear();
    h.tabs.annotations.delivered(
      'a',
      delivered.map((entry) => entry.id),
    );
    expect(h.tabs.annotations.pending('a').map((entry) => entry.selector)).toEqual(['#late']);
    expect(pageA.evaluate).toHaveBeenCalledTimes(1);
    await h.tabs.dispose();
  });

  it('drops a Run’s annotations on permanent removal only', async () => {
    const { h, pageA, pageB } = await twoRuns();
    await h.annotate(pageA, add('#a'));
    await h.annotate(pageB, add('#b'));
    await h.tabs.remove('a');
    expect(h.tabs.annotations.pending('a')).toEqual([]);
    expect(h.tabs.annotations.pending('b')).toHaveLength(1);
    await expect(h.annotate(pageA, { op: 'list' })).rejects.toThrow('Run pages');
    await h.tabs.dispose();
  });

  describe('served mockup pages', () => {
    const URL_A = 'http://127.0.0.1:3847/mockups/m1?size=desktop';
    const serve = { kind: 'workItem' as const, mockupId: 'm1', sizeKey: 'desktop', revision: 'r7' };

    it('takes mockup identity from the serve behind the page, with the element anchor', async () => {
      const { h, pageA, pageB } = await twoRuns();
      await pageA.goto(URL_A);
      navigationResponse(pageA, URL_A, h.tabs.mockupServes.issue(serve));
      await pageB.goto(URL_A);
      navigationResponse(pageB, URL_A, h.tabs.mockupServes.issue({ ...serve, revision: 'r8' }));
      await h.annotate(pageA, {
        op: 'add',
        annotation: { ...add('[data-hh-id="helmet"]', 'darker').annotation, elementId: 'helmet' },
      });
      await h.annotate(pageB, add('#x'));
      expect(h.tabs.annotations.pending('a')).toMatchObject([
        { elementId: 'helmet', mockup: serve },
      ]);
      expect(h.tabs.annotations.pending('b')).toMatchObject([
        { elementId: null, mockup: { ...serve, revision: 'r8' } },
      ]);
      await h.tabs.dispose();
    });

    it('replaces the record on reload and ignores unknown or missing serve ids', async () => {
      const { h, pageA } = await twoRuns();
      await pageA.goto(URL_A);
      navigationResponse(pageA, URL_A, h.tabs.mockupServes.issue(serve));
      navigationResponse(pageA, URL_A, h.tabs.mockupServes.issue({ ...serve, revision: 'r9' }));
      await h.annotate(pageA, add('#a'));
      navigationResponse(pageA, URL_A, 'forged-by-another-site');
      await h.annotate(pageA, add('#b'));
      navigationResponse(pageA, URL_A);
      await h.annotate(pageA, add('#c'));
      expect(h.tabs.annotations.pending('a').map((entry) => entry.mockup)).toEqual([
        { ...serve, revision: 'r9' },
        null,
        null,
      ]);
      await h.tabs.dispose();
    });

    it('does not attribute a serve to a different document on the same page', async () => {
      const { h, pageA } = await twoRuns();
      await pageA.goto(URL_A);
      navigationResponse(pageA, URL_A, h.tabs.mockupServes.issue(serve));
      await pageA.goto('http://localhost:3000/other');
      await h.annotate(pageA, add('#a'));
      expect(h.tabs.annotations.pending('a')[0]!.mockup).toBeNull();
      await h.tabs.dispose();
    });

    it('rejects mockup identity supplied by the page', async () => {
      const { h, pageA } = await twoRuns();
      await expect(
        h.annotate(pageA, {
          op: 'add',
          annotation: { ...add('#a').annotation, mockup: serve },
        }),
      ).rejects.toThrow('Invalid annotation message');
      await h.tabs.dispose();
    });
  });

  it('formats the agent-facing block', () => {
    expect(
      formatBrowserAnnotations([
        {
          id: '1',
          url: 'http://localhost:3000/settings',
          selector: '[data-testid="save-btn"]',
          role: 'button',
          text: 'Save changes',
          note: 'this is misaligned with the cancel button',
          elementId: null,
          mockup: null,
        },
        {
          id: '2',
          url: 'about:blank',
          selector: 'div:nth-of-type(1)',
          role: 'generic',
          text: '',
          note: '',
          elementId: null,
          mockup: null,
        },
        {
          id: '3',
          url: 'http://localhost:3847/mockups/m1?size=desktop',
          selector: '[data-hh-id="helmet"]',
          role: 'img',
          text: '',
          note: 'too dark',
          elementId: 'helmet',
          mockup: { kind: 'workItem', mockupId: 'm1', sizeKey: 'desktop', revision: 'r7' },
        },
        {
          id: '4',
          url: 'http://localhost:3847/mockups/proposals/p1?section=preview&size=desktop',
          selector: '[data-hh-id="cta"]',
          role: 'button',
          text: '',
          note: 'bigger',
          elementId: 'cta',
          mockup: { kind: 'proposal', proposalId: 'p1', sectionKey: 'preview', sizeKey: 'desktop' },
        },
      ]),
    ).toBe(
      [
        'Browser annotations:',
        '1. localhost:3000/settings - [data-testid="save-btn"] button "Save changes"',
        '   Note: this is misaligned with the cancel button',
        '2. about:blank - div:nth-of-type(1) generic',
        '3. localhost:3847/mockups/m1?size=desktop - [data-hh-id="helmet"] img',
        '   Mockup: m1, size desktop, revision r7, element helmet',
        '   Note: too dark',
        '4. localhost:3847/mockups/proposals/p1?section=preview&size=desktop - [data-hh-id="cta"] button',
        '   Mockup: proposal p1, section preview, size desktop, element cta',
        '   Note: bigger',
      ].join('\n'),
    );
  });
});
