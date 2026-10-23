import { Router, type Request, type Response } from 'express';
import type { MockupServe, MockupServes } from '../../browser/mockup-serves';
import { MOCKUP_SERVE_HEADER } from '../../browser/mockup-serves';
import { NOOP_LOGGER, type ServerLogger } from '../logger';
import { LOOPBACK_HOST } from './browser-start-page';
import { MockupReadError, type MockupReader, type MockupSource } from '../mockup-page-reader';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIZE_KEY_PATTERN = /^[\w.-]{1,100}$/u;
/** Scripts do not run and nothing external loads; the overlay is injected by the browser, not the page. */
const CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

export interface MockupPageRouteDependencies {
  readMockup: MockupReader;
  serves: Pick<MockupServes, 'issue'>;
  logger?: ServerLogger;
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/gu, (char) => `&#${String(char.charCodeAt(0))};`);

const errorPage = (message: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Mockup unavailable</title></head>` +
  `<body><p>${escapeHtml(message)}</p></body></html>`;

const mockupPage = ({ html, css, width, height }: MockupSource): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Mockup</title>` +
  `<style>${css.replace(/<\/style/giu, '<\\/style')}</style></head>` +
  `<body><div style="width:${String(width)}px;min-height:${String(height)}px">${html}</div></body></html>`;

const send = (response: Response, status: number, body: string, serveId?: string): void => {
  response
    .status(status)
    .type('html')
    .set({
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      ...(serveId ? { [MOCKUP_SERVE_HEADER]: serveId } : {}),
    })
    .send(body);
};

type MockupServeRequest =
  | { kind: 'workItem'; mockupId: string }
  | {
      kind: 'proposal';
      proposalId: string;
      sectionKey: string;
    };

const isValidSizeKey = (size: unknown): size is string | undefined =>
  size === undefined || (typeof size === 'string' && SIZE_KEY_PATTERN.test(size));

/**
 * Serves a mockup as a standalone page for a Run's browser tab: a work item's
 * approved mockup at `/mockups/:mockupId?organizationId=&projectId=&size=`, or
 * a mockup as a proposal holds it at
 * `/mockups/proposals/:proposalId?organizationId=&projectId=&section=&size=`.
 * The page opens by navigation, so there is no Origin to approve; instead only
 * loopback hosts and top-level document loads are answered, and the platform
 * read decides whether this user may see the mockup.
 */
export const createMockupPageRouter = ({
  readMockup,
  serves,
  logger = NOOP_LOGGER,
}: MockupPageRouteDependencies): Router => {
  const router = Router();

  const isLoopbackDocumentLoad = (request: Request, response: Response): boolean => {
    const dest = request.get('sec-fetch-dest');
    if (LOOPBACK_HOST.test(request.get('host') ?? '') && (!dest || dest === 'document')) {
      return true;
    }
    logger.warn('local.mockup_page.rejected', { reason: 'not_a_loopback_document_load' });
    send(response, 403, errorPage('This page can only be opened in the local browser.'));
    return false;
  };

  const serve = async (
    response: Response,
    target: MockupServeRequest,
    organizationId: string,
    projectId: string,
    size: string | undefined,
  ): Promise<void> => {
    try {
      const mockup = await readMockup({
        ...target,
        organizationId,
        projectId,
        sizeKey: size ?? null,
      });
      let identity: MockupServe;
      if (target.kind === 'proposal') {
        identity = { ...target, sizeKey: mockup.sizeKey };
      } else if (mockup.revision !== null) {
        identity = { ...target, sizeKey: mockup.sizeKey, revision: mockup.revision };
      } else {
        throw new MockupReadError('unreadable', 'The mockup has no approved revision.');
      }
      send(response, 200, mockupPage(mockup), serves.issue(identity));
    } catch (error) {
      if (!(error instanceof MockupReadError)) {
        logger.error('local.mockup_page.failed', { target, error });
        send(response, 500, errorPage('The mockup page could not be served.'));
        return;
      }
      logger.warn('local.mockup_page.unreadable', { target, failure: error.failure, error });
      const status =
        error.failure === 'not_found' ? 404 : error.failure === 'invalid_size' ? 400 : 502;
      send(response, status, errorPage(error.message));
    }
  };

  router.get('/mockups/proposals/:proposalId', async (request, response) => {
    if (!isLoopbackDocumentLoad(request, response)) return;
    const { proposalId } = request.params;
    const { organizationId, projectId, section, size } = request.query;
    if (
      !UUID_PATTERN.test(proposalId) ||
      typeof organizationId !== 'string' ||
      !UUID_PATTERN.test(organizationId) ||
      typeof projectId !== 'string' ||
      !UUID_PATTERN.test(projectId) ||
      typeof section !== 'string' ||
      !SIZE_KEY_PATTERN.test(section) ||
      !isValidSizeKey(size)
    ) {
      send(response, 400, errorPage('The mockup address is not valid.'));
      return;
    }
    await serve(
      response,
      { kind: 'proposal', proposalId, sectionKey: section },
      organizationId,
      projectId,
      size,
    );
  });

  router.get('/mockups/:mockupId', async (request, response) => {
    if (!isLoopbackDocumentLoad(request, response)) return;
    const { mockupId } = request.params;
    const { organizationId, projectId, size } = request.query;
    if (
      !UUID_PATTERN.test(mockupId) ||
      typeof organizationId !== 'string' ||
      !UUID_PATTERN.test(organizationId) ||
      typeof projectId !== 'string' ||
      !UUID_PATTERN.test(projectId) ||
      !isValidSizeKey(size)
    ) {
      send(response, 400, errorPage('The mockup address is not valid.'));
      return;
    }
    await serve(response, { kind: 'workItem', mockupId }, organizationId, projectId, size);
  });
  return router;
};
