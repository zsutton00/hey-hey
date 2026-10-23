import { randomUUID } from 'node:crypto';
import type { Browser, Page } from 'playwright-core';
import { SharedBrowserDisabledError, type ProjectBrowser } from './project-browser-manager';
import { BrowserTabNotices } from './browser-tab-notices';
import { MockupServes } from './mockup-serves';
import { PageAnnotations } from './page-annotations';
import type { ServerLogger } from '../server/logger';
import { LocalAgentApiError } from '../shared/agent-bridge-contract/errors';

const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:', 'about:']);

/** The schemes a Run's tab may be sent to, by the agent or by the user. */
export const isAllowedBrowserUrl = (url: string): boolean => {
  try {
    return ALLOWED_URL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
};

/** The staged tab a starting Run was handed is closed, from a replaced browser, or unknown. */
export class StagedBrowserTabNotFoundError extends LocalAgentApiError {
  public constructor(stagedTabId: string) {
    super(
      'STAGED_BROWSER_TAB_NOT_FOUND',
      `The browser tab ${stagedTabId} opened before the session started is no longer open.`,
      404,
    );
    this.name = 'StagedBrowserTabNotFoundError';
  }
}

/** A tab the user opened before its Run existed; outside every page family until adopted. */
interface StagedTab {
  projectId: string;
  browser: Browser;
  page: Page;
}

export interface OwnedPage {
  id: string;
  page: Page;
  refs: Set<string>;
  console: string[];
  unusable: boolean;
}
export interface PageFamily {
  projectId: string;
  browser: Browser | null;
  disconnected: boolean;
  disconnectListener: (() => void) | null;
  selected: OwnedPage | null;
  pages: Map<string, OwnedPage>;
  removed: boolean;
}

/** Page lifetime follows Run identity, independently of registry residency. */
export class RunTabs {
  private readonly families = new Map<string, PageFamily>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly removals = new Set<Promise<void>>();
  /** Tabs opened before their Run exists, by staged id. Never closed by us. */
  private readonly staged = new Map<string, StagedTab>();
  /** Which Run took each staged tab, so a retried start of that Run adopts it again as a no-op. */
  private readonly adoptions = new Map<string, { runId: string; pageId: string }>();
  private disposed = false;
  /** Annotations live and die with the Run's page family, not its registry residency. */
  public readonly annotations: PageAnnotations;
  /** User-opened-tab notices share the page family's lifetime like annotations. */
  public readonly notices = new BrowserTabNotices();
  /** Which mockup each tab was served; the served-revision record annotations take mockup identity from. */
  public readonly mockupServes = new MockupServes();

  public constructor(
    private readonly browsers: ProjectBrowser,
    private readonly logger: ServerLogger,
  ) {
    this.annotations = new PageAnnotations(
      {
        ownerOf: (page) => this.ownerOf(page),
        pagesOf: (runId) => this.pagesOf(runId),
      },
      this.mockupServes,
      logger,
    );
  }

  public async use<T>(
    runId: string,
    projectId: string,
    operation: (family: PageFamily, selected: OwnedPage) => Promise<T>,
    admitted: () => boolean = () => true,
  ): Promise<T> {
    if (this.disposed) throw new Error('Browser pages disposed');
    const owned = this.familyOf(runId, projectId);
    return this.enqueue(runId, async () => {
      const browser = await this.bindBrowser(runId, owned, admitted);
      if (!owned.selected || owned.selected.unusable || owned.selected.page.isClosed()) {
        const context = browser.contexts()[0];
        if (!context) throw new Error('Project browser context unavailable');
        await this.annotations.install(context);
        const page = await this.createPage(runId, context.newPage());
        if (owned.removed || !admitted()) {
          await this.closePage(runId, page);
          throw new Error('Browser access expired');
        }
        owned.selected = this.adopt(runId, owned, page);
        this.logger.debug('browser.run_page.created', { runId });
      }
      if (owned.removed || !admitted()) throw new Error('Browser access expired');
      return operation(owned, owned.selected);
    });
  }

  /**
   * Opens a tab at `url` in the project's Shared Browser before any Run exists
   * and returns its staged id. The tab is owned by no Run, so no Run's tools
   * reach it until a starting Run adopts it, and it is never closed here.
   */
  public async stage(projectId: string, url: string): Promise<string> {
    if (this.disposed) throw new Error('Browser pages disposed');
    if (!isAllowedBrowserUrl(url)) throw new Error('Unsupported navigation scheme');
    if (!(await this.browsers.isEnabled())) throw new SharedBrowserDisabledError();
    const browser = await this.browsers.getBrowser(projectId);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Project browser context unavailable');
    await this.annotations.install(context);
    const stagedTabId = randomUUID();
    const page = await this.createPage(stagedTabId, context.newPage());
    try {
      if (url !== 'about:blank') {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      }
      await page.bringToFront();
    } catch (error) {
      // A failed open leaves no tab behind.
      await this.closePage(stagedTabId, page);
      throw error;
    }
    this.staged.set(stagedTabId, { projectId, browser, page });
    page.once('close', () => this.staged.delete(stagedTabId));
    this.logger.debug('browser.staged_page.opened', { stagedTabId });
    return stagedTabId;
  }

  /**
   * Makes a staged tab the starting Run's own selected page, through the Run's
   * queue, and records the user-opened-tab notice its first Turn delivers. A
   * tab that was closed, belongs to a disconnected or replaced browser or to
   * another project, or was never staged here is gone: the start must not
   * proceed on a substitute page.
   */
  public async adoptStaged(runId: string, projectId: string, stagedTabId: string): Promise<void> {
    if (this.disposed) throw new Error('Browser pages disposed');
    const owned = this.familyOf(runId, projectId);
    await this.enqueue(runId, async () => {
      const adoption = this.adoptions.get(stagedTabId);
      if (adoption?.runId === runId && owned.pages.has(adoption.pageId)) return;
      const entry = this.staged.get(stagedTabId);
      if (
        entry?.projectId !== projectId ||
        entry.page.isClosed() ||
        !entry.browser.isConnected() ||
        !(await this.browsers.isEnabled()) ||
        (await this.browsers.getBrowser(projectId)) !== entry.browser
      )
        throw new StagedBrowserTabNotFoundError(stagedTabId);
      await this.bindBrowser(runId, owned, () => true);
      this.staged.delete(stagedTabId);
      owned.selected = this.adopt(runId, owned, entry.page);
      this.adoptions.set(stagedTabId, { runId, pageId: owned.selected.id });
      entry.page.once('close', () => this.adoptions.delete(stagedTabId));
      this.notices.record(runId, { id: randomUUID(), url: entry.page.url() });
      this.logger.debug('browser.staged_page.adopted', { runId, stagedTabId });
    });
  }

  private familyOf(runId: string, projectId: string): PageFamily {
    let family = this.families.get(runId);
    if (!family) {
      family = {
        projectId,
        browser: null,
        disconnected: false,
        disconnectListener: null,
        selected: null,
        pages: new Map(),
        removed: false,
      };
      this.families.set(runId, family);
    }
    if (family.projectId !== projectId) throw new Error('Run project mismatch');
    return family;
  }

  /** Serializes a Run's page work so a family is never bound or selected concurrently. */
  private enqueue<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(runId) ?? Promise.resolve();
    const result = previous.then(work);
    const settled = result.then(
      () => {},
      () => {},
    );
    this.queues.set(runId, settled);
    void settled.then(() => {
      if (this.queues.get(runId) === settled) this.queues.delete(runId);
    });
    return result;
  }

  /** Binds the family to the project's current browser, dropping pages from a replaced one. */
  private async bindBrowser(
    runId: string,
    owned: PageFamily,
    admitted: () => boolean,
  ): Promise<Browser> {
    if (owned.removed || !admitted()) throw new Error('Browser access expired');
    if (!(await this.browsers.isEnabled())) throw new SharedBrowserDisabledError();
    const browser = await this.browsers.getBrowser(owned.projectId);
    if (owned.removed || !admitted()) throw new Error('Browser access expired');
    if (owned.browser !== browser || owned.disconnected || !browser.isConnected()) {
      await this.closePages(runId, owned);
      if (owned.disconnectListener) owned.browser?.off('disconnected', owned.disconnectListener);
      owned.browser = browser;
      owned.disconnected = false;
      owned.disconnectListener = () => {
        owned.disconnected = true;
      };
      browser.on('disconnected', owned.disconnectListener);
    }
    return browser;
  }

  /**
   * Opens a new Run-owned tab at `url` and selects it, so the agent's next
   * browser tool call addresses it. Runs through the Run's queue like `use`.
   */
  public async open(runId: string, projectId: string, url: string): Promise<void> {
    if (!isAllowedBrowserUrl(url)) throw new Error('Unsupported navigation scheme');
    await this.use(runId, projectId, async (family, selected) => {
      let target = selected;
      // A blank selection (often just created by `use`) is reused instead of left behind.
      if (selected.page.url() !== 'about:blank') {
        const context = family.browser?.contexts()[0];
        if (!context) throw new Error('Project browser context unavailable');
        const page = await this.createPage(runId, context.newPage());
        if (family.removed) {
          await this.closePage(runId, page);
          throw new Error('Browser access expired');
        }
        target = this.adopt(runId, family, page);
      }
      family.selected = target;
      target.refs.clear();
      if (url !== 'about:blank') {
        await target.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      }
      await target.page.bringToFront();
      this.logger.debug('browser.run_page.user_opened', { runId });
    });
  }

  public remove(runId: string): Promise<void> {
    const family = this.families.get(runId);
    if (!family) return Promise.resolve();
    family.removed = true;
    this.families.delete(runId);
    this.annotations.drop(runId);
    this.notices.drop(runId);
    const removal = this.finishRemoval(runId, family);
    this.removals.add(removal);
    void removal.then(() => this.removals.delete(removal));
    return removal;
  }

  private async finishRemoval(runId: string, family: PageFamily): Promise<void> {
    await this.queues.get(runId);
    await this.closePages(runId, family);
    if (family.disconnectListener) family.browser?.off('disconnected', family.disconnectListener);
    this.logger.debug('browser.run_pages.removed', { runId });
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    this.staged.clear();
    this.adoptions.clear();
    await Promise.allSettled([...this.families.keys()].map((runId) => this.remove(runId)));
    await Promise.allSettled(this.removals);
  }

  private ownerOf(page: Page): string | null {
    for (const [runId, family] of this.families) {
      for (const owned of family.pages.values()) {
        if (owned.page === page && !owned.unusable) return runId;
      }
    }
    return null;
  }

  private pagesOf(runId: string): Page[] {
    const family = this.families.get(runId);
    if (!family) return [];
    return [...family.pages.values()]
      .filter((owned) => !owned.unusable && !owned.page.isClosed())
      .map((owned) => owned.page);
  }

  private adopt(runId: string, family: PageFamily, page: Page): OwnedPage {
    const owned: OwnedPage = {
      id: randomUUID(),
      page,
      refs: new Set(),
      console: [],
      unusable: false,
    };
    family.pages.set(owned.id, owned);
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(10_000);
    page.on('popup', (popup) => {
      if (family.removed || owned.unusable || !family.pages.has(owned.id)) {
        void this.closePage(runId, popup);
        return;
      }
      this.adopt(runId, family, popup);
      this.logger.debug('browser.run_popup.adopted', { runId });
    });
    page.on('console', (message) => {
      owned.console.push(`${message.type()}: ${message.text().slice(0, 2000)}`);
      if (owned.console.length > 100) owned.console.shift();
    });
    page.on('response', (response) => {
      this.mockupServes.observe(page, response);
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) owned.refs.clear();
    });
    page.on('close', () => {
      owned.refs.clear();
      family.pages.delete(owned.id);
    });
    // A popup's document can load before adoption; its overlay re-reads now that the page is owned.
    this.annotations.sync(page);
    return owned;
  }

  private async closePage(runId: string, page: Page): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        page.close({ runBeforeUnload: false }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Page cleanup timed out')), 10_000);
        }),
      ]);
    } catch {
      this.logger.warn('browser.run_page.cleanup_failed', { runId });
    } finally {
      clearTimeout(timer);
    }
  }
  private async createPage(runId: string, creation: Promise<Page>): Promise<Page> {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void creation.then(
      (page) => {
        if (expired) void this.closePage(runId, page);
      },
      () => {},
    );
    try {
      return await Promise.race([
        creation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(new Error('Page creation timed out'));
          }, 10_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async closePages(runId: string, family: PageFamily): Promise<void> {
    const pages = [...family.pages.values()];
    family.pages.clear();
    family.selected = null;
    await Promise.allSettled(pages.map((owned) => this.closePage(runId, owned.page)));
  }
}
