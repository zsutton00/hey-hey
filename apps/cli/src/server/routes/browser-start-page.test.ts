import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { browserStartPageUrl, createBrowserStartPageRouter } from './browser-start-page';

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

const start = async () => {
  const app = express();
  app.use(createBrowserStartPageRouter());
  const listening = createServer(app);
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve));
  server = listening;
  return `http://127.0.0.1:${String((listening.address() as AddressInfo).port)}/browser/start`;
};

describe('browserStartPageUrl', () => {
  it('addresses the start page on a loopback host only', () => {
    expect(browserStartPageUrl('127.0.0.1:4100')).toBe('http://127.0.0.1:4100/browser/start');
    expect(browserStartPageUrl('localhost:4100')).toBe('http://localhost:4100/browser/start');
    expect(browserStartPageUrl('evil.test')).toBeNull();
    expect(browserStartPageUrl(undefined)).toBeNull();
  });
});

describe('browser start page', () => {
  it('explains the tab and the annotation toolbar without running scripts', async () => {
    const response = await fetch(await start(), { headers: { 'sec-fetch-dest': 'document' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const body = await response.text();
    expect(body).toContain('Annotate');
    expect(body).not.toContain('<script');
  });

  it('refuses non-document loads', async () => {
    const response = await fetch(await start(), { headers: { 'sec-fetch-dest': 'iframe' } });

    expect(response.status).toBe(403);
  });
});
