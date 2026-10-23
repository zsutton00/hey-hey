import { Router } from 'express';
import { NOOP_LOGGER, type ServerLogger } from '../logger';

const BROWSER_START_PAGE_PATH = '/browser/start';
export const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/iu;
/** Scripts do not run and nothing external loads; the overlay is injected by the browser, not the page. */
const CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'";

/** The start page's address on the CLI the request reached, or null when the host is not loopback. */
export const browserStartPageUrl = (host: string | undefined): string | null =>
  host && LOOPBACK_HOST.test(host) ? `http://${host}${BROWSER_START_PAGE_PATH}` : null;

const START_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Hey Hey browser</title>
<style>
body { margin: 0; font: 15px/1.6 system-ui, sans-serif; color: #111827; background: #f9fafb; }
main { max-width: 640px; margin: 64px auto; padding: 0 24px; }
h1 { font-size: 24px; margin: 0 0 8px; }
h2 { font-size: 16px; margin: 28px 0 4px; }
kbd { padding: 1px 6px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; font: 13px ui-monospace, monospace; }
</style></head><body><main>
<h1>This tab belongs to your session</h1>
<p>The agent in your session can see and use this tab. Go to any page by typing its address in the address bar above, for example your app running locally.</p>
<h2>Point at things instead of describing them</h2>
<p>The toolbar in the bottom-right corner of every page in this tab lets you annotate it:</p>
<ul>
<li><b>Annotate</b> turns on the picker. Hover to highlight an element, click it to select it, then add a note.</li>
<li><b>View comments</b> lists the annotations on the page you are looking at.</li>
<li><b>Clear</b> removes all of your annotations.</li>
</ul>
<h2>What the agent sees</h2>
<p>Your annotations and the pages you open are passed to the agent with your next message. It is not interrupted while it works.</p>
</main></body></html>`;

/**
 * The page a Run's tab starts on when the user opens it without an address,
 * so the tab is never a blank document the annotation overlay cannot reach.
 */
export const createBrowserStartPageRouter = ({
  logger = NOOP_LOGGER,
}: { logger?: ServerLogger } = {}): Router => {
  const router = Router();
  router.get(BROWSER_START_PAGE_PATH, (request, response) => {
    const dest = request.get('sec-fetch-dest');
    if (!browserStartPageUrl(request.get('host')) || (dest && dest !== 'document')) {
      logger.warn('local.browser_start_page.rejected', { reason: 'not_a_loopback_document_load' });
      response.status(403).type('text').send('This page can only be opened in the local browser.');
      return;
    }
    response
      .type('html')
      .set({
        'Content-Security-Policy': CONTENT_SECURITY_POLICY,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      })
      .send(START_PAGE);
  });
  return router;
};
