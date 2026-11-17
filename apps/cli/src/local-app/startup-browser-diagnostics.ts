import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { LocalStartupBrowserEvent } from '@hey-hey/contracts/agent-bridge';
import { z } from 'zod';
import { safeStartupCause } from './startup-diagnostic-boundary';
import type { StartupDiagnostics } from './startup-diagnostics';

/** Receives only closed-vocabulary events; its capability cannot authorize any other action. */
export class StartupBrowserDiagnostics {
  private readonly token = randomBytes(32).toString('base64url');
  private server: Server | undefined;
  private port: number | undefined;
  private count = 0;
  private lastAttempt: string | undefined;

  constructor(
    private readonly journal: StartupDiagnostics,
    private readonly origin: string,
  ) {}

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      const host = `127.0.0.1:${this.port}`;
      if (
        request.headers.host !== host ||
        request.headers.origin !== this.origin ||
        request.url !== '/local-startup/events'
      ) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader('Access-Control-Allow-Origin', this.origin);
      response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'POST');
        response.setHeader('Access-Control-Allow-Headers', 'X-HeyHey-Diagnostic, Content-Type');
        response.writeHead(204).end();
        return;
      }
      const supplied = request.headers['x-heyhey-diagnostic'];
      if (
        request.method !== 'POST' ||
        typeof supplied !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/u.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token))
      ) {
        response.writeHead(403).end();
        return;
      }
      if (this.lastAttempt !== this.journal.attemptId) {
        this.lastAttempt = this.journal.attemptId;
        this.count = 0;
      }
      if (++this.count > 120) {
        if (this.count === 121) {
          this.journal.record('browser.evidence.truncated', { reasonCode: 'browser_event_limit' });
        }
        response.writeHead(429).end();
        return;
      }
      let bytes = 0;
      let body = '';
      let rejected = false;
      request.on('data', (chunk: Buffer) => {
        if (rejected) {
          return;
        }
        bytes += chunk.length;
        if (bytes > 128) {
          rejected = true;
          response.writeHead(413).end();
          request.destroy();
          return;
        }
        body += chunk.toString('utf8');
      });
      request.on('end', () => {
        if (rejected) {
          return;
        }
        const parsed = z.nativeEnum(LocalStartupBrowserEvent).safeParse(body);
        if (!parsed.success) {
          response.writeHead(400).end();
          return;
        }
        this.journal.record('browser.setup', { state: parsed.data });
        if (parsed.data.endsWith('_failed') || parsed.data === 'connection_timeout') {
          this.journal.failure();
        }
        response.writeHead(204).end();
      });
      request.on('error', (error) => {
        this.journal.record('browser.evidence.unavailable', { error: safeStartupCause(error) });
      });
    });
    server.requestTimeout = 3000;
    server.headersTimeout = 3000;
    server.maxConnections = 4;
    this.server = server;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject);
          const address = server.address();
          if (address && typeof address !== 'string') {
            this.port = address.port;
          }
          resolve();
        });
      });
      server.on('error', (error) => {
        this.journal.record('browser.evidence.unavailable', { error: safeStartupCause(error) });
      });
      server.unref();
      this.journal.record('browser.evidence.started', { reasonCode: 'awaiting_browser_events' });
    } catch (error) {
      this.journal.record('browser.evidence.unavailable', { error: safeStartupCause(error) });
    }
  }

  decorate(target: string): string {
    if (!this.port) {
      return target;
    }
    const url = new URL(target);
    const fragment = new URLSearchParams(url.hash.slice(1));
    fragment.set('diagnosticPort', String(this.port));
    fragment.set('diagnosticToken', this.token);
    url.hash = fragment.toString();
    return url.toString();
  }

  close(): void {
    this.journal.record('browser.evidence.finished', {
      acceptedOrRefusedCount: this.count,
      reasonCode: this.count === 0 ? 'no_browser_events_observed' : 'listener_closed',
    });
    this.server?.closeAllConnections();
    this.server?.close();
  }
}
