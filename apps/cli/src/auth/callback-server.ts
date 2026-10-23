import http from 'node:http';

export interface CallbackResult {
  code: string;
  state: string;
}

export type CallbackOutcome =
  | { type: 'success'; code: string; state: string }
  | { type: 'error'; description: string }
  | { type: 'invalid' };

export const parseOAuthCallback = (url: string): CallbackOutcome => {
  const parsed = new URL(url, 'http://localhost');
  const params = parsed.searchParams;

  if (parsed.pathname !== '/callback') {
    return { type: 'invalid' };
  }

  const errorDesc = params.get('error_description');
  if (errorDesc) {
    return { type: 'error', description: errorDesc };
  }

  const code = params.get('code');
  const state = params.get('state');

  if (code && state) {
    return { type: 'success', code, state };
  }

  return { type: 'invalid' };
};

export class OAuthCallbackServer {
  port = 0;

  private readonly server: http.Server;
  private callbackResolver: ((result: CallbackResult) => void) | null = null;
  private callbackRejector: ((error: Error) => void) | null = null;

  constructor(private readonly requestedPort: number = 0) {
    this.server = http.createServer((req, res) => {
      const outcome = parseOAuthCallback(req.url || '');

      if (outcome.type === 'success') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Authentication complete. You may close this window.');
        if (this.callbackResolver) {
          this.callbackResolver({ code: outcome.code, state: outcome.state });
        }
      } else if (outcome.type === 'error') {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`OAuth error: ${outcome.description}`);
        if (this.callbackRejector) {
          this.callbackRejector(new Error(`OAuth error: ${outcome.description}`));
        }
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid OAuth callback');
      }
    });

    this.server.on('error', (error) => {
      this.callbackRejector?.(error);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const handleStartupError = (error: Error): void => {
        reject(error);
      };
      this.server.once('error', handleStartupError);
      this.server.listen(this.requestedPort, '127.0.0.1', () => {
        this.server.off('error', handleStartupError);
        const address = this.server.address();
        if (!address || typeof address === 'string') {
          this.server.close();
          reject(new Error('Failed to bind callback server'));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
  }

  waitForCallback(): Promise<CallbackResult> {
    return new Promise((resolve, reject) => {
      this.callbackResolver = resolve;
      this.callbackRejector = reject;
    });
  }

  close(): void {
    this.server.close();
  }
}
