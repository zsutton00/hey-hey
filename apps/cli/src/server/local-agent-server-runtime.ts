import type { Server as HttpServer } from 'node:http';
import type { ProjectBrowser } from '../browser/project-browser-manager';
import type {
  LocalAgentApplicationLifecycle,
  LocalPresentationSources,
} from './local-agent-application-lifecycle';
import type { LocalAgentEndpoint } from './local-base-url';
import type { ServerLogger } from './logger';

export interface LocalAgentServerRuntimeDependencies {
  httpServer: HttpServer;
  localAgentEndpoint: LocalAgentEndpoint;
  applicationLifecycle: LocalAgentApplicationLifecycle;
  logger: ServerLogger;
  host: string;
  preferredPort: number;
  projectBrowsers: ProjectBrowser;
}

const hasErrorCode = (error: unknown): error is Error & { code: string } =>
  error instanceof Error && 'code' in error && typeof error.code === 'string';

/** Owns the listening bridge, startup rollback, and shutdown state. */
export class LocalAgentServerRuntime {
  public port = 0;
  public url = '';

  private isClosed = false;

  public constructor(private readonly dependencies: LocalAgentServerRuntimeDependencies) {}

  /** The CLI-owned per-project shared browsers. */
  public get projectBrowsers(): ProjectBrowser {
    return this.dependencies.projectBrowsers;
  }

  public get presentationSources(): LocalPresentationSources {
    return this.dependencies.applicationLifecycle.presentationSources;
  }

  public async start(): Promise<this> {
    const { httpServer, host, preferredPort, logger } = this.dependencies;
    try {
      this.port = await this.listen(httpServer, host, preferredPort);
    } catch (error) {
      if (hasErrorCode(error) && error.code === 'EADDRINUSE') {
        logger.error('local.server.port_in_use', { host, port: preferredPort });
        await this.rollbackStartup();
        throw new Error(
          `Local agent server port ${String(preferredPort)} is already in use — ` +
            `another CLI instance for this profile is already running. Stop it before ` +
            `starting a new one (or pass --port <port> to intentionally run another instance).`,
        );
      }
      await this.rollbackStartup();
      throw error;
    }

    this.url = `http://${host}:${String(this.port)}`;
    this.dependencies.localAgentEndpoint.set(this.url);
    logger.debug('local.server.started', { host, port: this.port, url: this.url });
    return this;
  }

  public readonly close = async (): Promise<void> => {
    if (this.isClosed) return;
    this.isClosed = true;
    await this.disposeOwnedResources(true);
    this.dependencies.logger.debug('local.server.stopped', {
      host: this.dependencies.host,
      port: this.port,
    });
  };

  private async rollbackStartup(): Promise<void> {
    await this.disposeOwnedResources(false);
  }

  private async disposeOwnedResources(closeHttp: boolean): Promise<void> {
    await this.dependencies.applicationLifecycle.dispose();
    this.dependencies.localAgentEndpoint.clear();
    if (closeHttp) await this.closeHttpServer(this.dependencies.httpServer).catch(() => undefined);
  }

  private listen(server: HttpServer, host: string, port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (error: Error & { code?: string }): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Local server started without a TCP port.'));
          return;
        }
        resolve(address.port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
  }

  private closeHttpServer(server: HttpServer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}
