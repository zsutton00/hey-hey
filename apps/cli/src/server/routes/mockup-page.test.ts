import express from 'express';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCKUP_SERVE_HEADER, MockupServes } from '../../browser/mockup-serves';
import { MockupReadError, type MockupReader } from '../mockup-page-reader';
import { createMockupPageRouter } from './mockup-page';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const MOCKUP = '33333333-3333-4333-8333-333333333333';

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

const start = async (readMockup: MockupReader, serves = new MockupServes()) => {
  const app = express();
  app.use(createMockupPageRouter({ readMockup, serves }));
  const listening = createServer(app);
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  server = listening;
  const base = `http://127.0.0.1:${String((listening.address() as AddressInfo).port)}`;
  return {
    url: (query = `organizationId=${ORG}&projectId=${PROJECT}&size=desktop`) =>
      `${base}/mockups/${MOCKUP}?${query}`,
    serves,
  };
};

const source = {
  html: '<button data-hh-id="helmet">Buy</button><script>alert(1)</script>',
  css: 'button{color:red}',
  sizeKey: 'desktop',
  width: 1280,
  height: 800,
  revision: 'proposal-7',
};

const requestWithHost = (address: string, host: string): Promise<number> => {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        headers: { host },
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.once('error', reject);
    request.end();
  });
};

describe('GET /mockups/:mockupId', () => {
  it('serves the stored HTML and CSS at the size, restricted, with a serve id', async () => {
    const readMockup = vi.fn<MockupReader>(() => Promise.resolve(source));
    const { url } = await start(readMockup);
    const response = await fetch(url());
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(readMockup).toHaveBeenCalledWith({
      organizationId: ORG,
      projectId: PROJECT,
      kind: 'workItem',
      mockupId: MOCKUP,
      sizeKey: 'desktop',
    });
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
    expect(response.headers.get(MOCKUP_SERVE_HEADER)).toBeTruthy();
    expect(body).toContain('<style>button{color:red}</style>');
    expect(body).toContain('width:1280px;min-height:800px');
    expect(body).toContain('data-hh-id="helmet"');
  });

  it('records what it served under the response header id', async () => {
    const { url, serves } = await start(() => Promise.resolve(source));
    const issue = vi.spyOn(serves, 'issue');
    await fetch(url());
    expect(issue).toHaveBeenCalledWith({
      kind: 'workItem',
      mockupId: MOCKUP,
      sizeKey: 'desktop',
      revision: 'proposal-7',
    });
  });

  it.each([
    ['not_found', 404],
    ['invalid_size', 400],
    ['unreadable', 502],
  ] as const)(
    'returns an error page and no serve id when the read fails as %s',
    async (failure, status) => {
      const { url, serves } = await start(() =>
        Promise.reject(new MockupReadError(failure, 'No such thing.')),
      );
      const issue = vi.spyOn(serves, 'issue');
      const response = await fetch(url());
      expect(response.status).toBe(status);
      expect(response.headers.get(MOCKUP_SERVE_HEADER)).toBeNull();
      expect(await response.text()).toContain('No such thing.');
      expect(issue).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed addresses without reading the platform', async () => {
    const readMockup = vi.fn<MockupReader>(() => Promise.resolve(source));
    const { url } = await start(readMockup);
    expect((await fetch(url('projectId=nope'))).status).toBe(400);
    expect((await fetch(url(`organizationId=${ORG}&projectId=${PROJECT}&size=a/b`))).status).toBe(
      400,
    );
    expect(readMockup).not.toHaveBeenCalled();
  });

  it('omits size when the address has none', async () => {
    const readMockup = vi.fn<MockupReader>(() => Promise.resolve(source));
    const { url } = await start(readMockup);
    await fetch(url(`organizationId=${ORG}&projectId=${PROJECT}`));
    expect(readMockup).toHaveBeenCalledWith(expect.objectContaining({ sizeKey: null }));
  });

  it('answers only loopback hosts and document loads', async () => {
    const readMockup = vi.fn<MockupReader>(() => Promise.resolve(source));
    const { url } = await start(readMockup);
    const reboundStatus = await requestWithHost(url(), 'evil.example');
    const framed = await fetch(url(), { headers: { 'sec-fetch-dest': 'iframe' } });
    expect(reboundStatus).toBe(403);
    expect(framed.status).toBe(403);
    expect(readMockup).not.toHaveBeenCalled();
  });
});

const PROPOSAL = '44444444-4444-4444-8444-444444444444';

describe('GET /mockups/proposals/:proposalId', () => {
  const proposalUrl = (base: string, query: string) =>
    `${base.replace(/\/mockups\/.*$/u, '')}/mockups/proposals/${PROPOSAL}?${query}`;
  const fullQuery = `organizationId=${ORG}&projectId=${PROJECT}&section=preview&size=desktop`;

  it('serves the proposed mockup, restricted, and records the proposal identity without a revision', async () => {
    const readMockup = vi.fn<MockupReader>(() => Promise.resolve({ ...source, revision: null }));
    const { url, serves } = await start(readMockup);
    const issue = vi.spyOn(serves, 'issue');
    const response = await fetch(proposalUrl(url(), fullQuery));
    expect(response.status).toBe(200);
    expect(readMockup).toHaveBeenCalledWith({
      organizationId: ORG,
      projectId: PROJECT,
      kind: 'proposal',
      proposalId: PROPOSAL,
      sectionKey: 'preview',
      sizeKey: 'desktop',
    });
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
    expect(response.headers.get(MOCKUP_SERVE_HEADER)).toBeTruthy();
    expect(issue).toHaveBeenCalledWith({
      kind: 'proposal',
      proposalId: PROPOSAL,
      sectionKey: 'preview',
      sizeKey: 'desktop',
    });
  });

  it('rejects an address without a valid section', async () => {
    const readMockup = vi.fn<MockupReader>(() => Promise.resolve(source));
    const { url } = await start(readMockup);
    const missing = await fetch(
      proposalUrl(url(), `organizationId=${ORG}&projectId=${PROJECT}&size=desktop`),
    );
    const malformed = await fetch(
      proposalUrl(url(), `organizationId=${ORG}&projectId=${PROJECT}&section=a/b`),
    );
    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(readMockup).not.toHaveBeenCalled();
  });

  it('answers only loopback document loads', async () => {
    const readMockup = vi.fn<MockupReader>(() => Promise.resolve(source));
    const { url } = await start(readMockup);
    const framed = await fetch(proposalUrl(url(), fullQuery), {
      headers: { 'sec-fetch-dest': 'iframe' },
    });
    expect(framed.status).toBe(403);
    expect(readMockup).not.toHaveBeenCalled();
  });

  it('returns the not-found page when the proposal does not propose the mockup', async () => {
    const { url } = await start(() =>
      Promise.reject(
        new MockupReadError('not_found', 'The proposal does not propose this mockup.'),
      ),
    );
    const response = await fetch(proposalUrl(url(), fullQuery));
    expect(response.status).toBe(404);
    expect(response.headers.get(MOCKUP_SERVE_HEADER)).toBeNull();
  });
});
