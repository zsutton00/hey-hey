import { randomUUID } from 'node:crypto';
import type { Page, Response } from 'playwright-core';

/** Response header carrying the id of one served mockup page; set by this CLI, never by page content. */
export const MOCKUP_SERVE_HEADER = 'x-heyhey-mockup-serve';

const MAX_ISSUED_SERVES = 200;

/** What a mockup page showed when the CLI served it; a proposal's mockup has no materialized revision. */
export type MockupServe =
  | { kind: 'workItem'; mockupId: string; sizeKey: string; revision: string }
  | { kind: 'proposal'; proposalId: string; sectionKey: string; sizeKey: string };

const withoutHash = (url: string): string => url.replace(/#.*$/su, '');

/**
 * Remembers what each Run-owned tab was served. The mockup request itself names
 * no Run, so the serve is matched to a tab by the header on that tab's own
 * navigation response; the id is unguessable, so other sites cannot forge one.
 */
export class MockupServes {
  private readonly issued = new Map<string, MockupServe>();
  /** Keyed by page, so a record is replaced on reload and dropped with the page. */
  private readonly shown = new WeakMap<Page, { url: string; serve: MockupServe }>();

  /** Registers a serve and returns the id to put on its response. */
  public issue(serve: MockupServe): string {
    const id = randomUUID();
    this.issued.set(id, serve);
    if (this.issued.size > MAX_ISSUED_SERVES) {
      const oldest = this.issued.keys().next();
      if (!oldest.done) this.issued.delete(oldest.value);
    }
    return id;
  }

  /** Called for every response a Run-owned page receives. */
  public observe(page: Page, response: Response): void {
    const request = response.request();
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    const id = response.headers()[MOCKUP_SERVE_HEADER];
    const serve = id === undefined ? undefined : this.issued.get(id);
    if (serve) this.shown.set(page, { url: withoutHash(response.url()), serve });
    else this.shown.delete(page);
  }

  /** The serve behind the page's current document, if it is a served mockup. */
  public shownOn(page: Page, url: string): MockupServe | null {
    const shown = this.shown.get(page);
    return shown?.url === withoutHash(url) ? shown.serve : null;
  }
}
