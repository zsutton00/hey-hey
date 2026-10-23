import { EventEmitter } from 'node:events';
import type { Browser, Frame, Page } from 'playwright-core';
import { vi } from 'vitest';
import { ProjectBrowserManager } from '../project-browser-manager';
import { RunTabs } from '../run-tabs';
import { NOOP_LOGGER } from '../../server/logger';

export class FakePage extends EventEmitter {
  public closed = false;
  public currentUrl = 'about:blank';
  public url = () => this.currentUrl;
  public isClosed = () => this.closed;
  public setDefaultTimeout = vi.fn();
  public setDefaultNavigationTimeout = vi.fn();
  public mainFrame = () => this;
  public close = vi.fn(async () => {
    this.closed = true;
    this.emit('close');
  });
  public goto = vi.fn(async (url: string) => {
    this.currentUrl = url;
    this.emit('framenavigated', this);
  });
  public ariaSnapshot = vi.fn(async () => '- textbox "Name" [ref=e1]\n- button "Save" [ref=e2]');
  public click = vi.fn(async () => {});
  public fill = vi.fn(async (_value: string) => {});
  public locator = vi.fn((_selector: string) => ({ click: this.click, fill: this.fill }));
  public getByRef = vi.fn((_ref: string) => ({ click: this.click, fill: this.fill }));
  public screenshot = vi.fn(async () => Buffer.from('png'));
  public evaluate = vi.fn(async () => '{"ok":true}');
  public bringToFront = vi.fn(() => Promise.resolve());
  public asPage = (): Page => this as unknown as Page;
}

export const browserHarness = () => {
  let enabled = true;
  const pages: FakePage[] = [];
  const newPage = vi.fn(async () => {
    const page = new FakePage();
    pages.push(page);
    return page.asPage();
  });
  const bindings = new Map<
    string,
    (source: { page: Page; frame: Frame }, raw: unknown) => unknown
  >();
  const initScripts: string[] = [];
  const exposeBinding = vi.fn(
    async (
      name: string,
      callback: (source: { page: Page; frame: Frame }, raw: unknown) => unknown,
    ) => {
      if (bindings.has(name)) throw new Error(`Function "${name}" has been already registered`);
      bindings.set(name, callback);
    },
  );
  const addInitScript = vi.fn(async (script: { content: string }) => {
    initScripts.push(script.content);
  });
  /** Calls the annotation binding as the overlay on `page` would; `frame` defaults to its main frame. */
  const annotate = async (page: FakePage, message: unknown, frame?: unknown): Promise<unknown> => {
    const binding = bindings.get('__heyheyAnnotate');
    if (!binding) throw new Error('Annotation binding not installed');
    const nonce = /"nonce":"([^"]+)"/u.exec(initScripts[0] ?? '')?.[1];
    return binding({ page: page.asPage(), frame: (frame ?? page) as Frame }, { nonce, message });
  };
  const context = { newPage, exposeBinding, addInitScript };
  const browser = new EventEmitter();
  const connected = vi.fn(() => true);
  Object.assign(browser, {
    contexts: () => [context],
    isConnected: connected,
    close: async () => {},
  });
  const manager = new ProjectBrowserManager({
    logger: NOOP_LOGGER,
    settings: {
      read: async () => ({ enabled }),
      write: async (value) => {
        enabled = value.enabled;
      },
    },
    launcher: { launch: async () => ({ wsEndpoint: 'ws://localhost:1', kill: async () => {} }) },
    connect: async () => browser as unknown as Browser,
  });
  const getBrowser = vi.spyOn(manager, 'getBrowser');
  const tabs = new RunTabs(manager, NOOP_LOGGER);
  return {
    manager,
    tabs,
    pages,
    newPage,
    getBrowser,
    browser,
    connected,
    exposeBinding,
    addInitScript,
    annotate,
  };
};
