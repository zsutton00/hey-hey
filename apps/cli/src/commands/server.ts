import { DockerBoundary } from '../local-app/docker-boundary';
import {
  type LocalApplicationNavigation,
  assertObservedRelease,
} from '../local-app/local-application';
import { sameRelease } from '../local-app/release-source';
import type { ReleaseManifest } from '../release/release-manifest';
import { SERVICE_IMAGES } from '../local-app/compose';
import { LocalLifecycleOwners, type LocalBridgeLifecycle } from '../local-app/lifecycle-owners';
import { InstallationStore } from '../local-app/installation-store';
import { LocalAgentServerBootstrap, type LocalTerminalOutput } from '../server/local-agent-server';
import type { LocalAgentServerRuntime } from '../server/local-agent-server-runtime';
import {
  PlatformUnavailableStartupError,
  StartupReadinessError,
  type StartupReadinessOutcome,
} from '../server/startup-readiness';
import { PairingRequiredStartupRecovery } from './pairing-required-startup-recovery';
import { PlatformUnavailableStartupPresenter } from './platform-unavailable-startup-presenter';

export interface ServerCommandOptions {
  localApplicationDirectory?: string;
  localApplicationRelease?: ReleaseManifest;
  localApplicationNavigation?: LocalApplicationNavigation;
  /**
   * Compose services that must be running before connecting. Defaults to the full installed
   * stack. Only `heyhey local dev` sets this: it runs the API and UI from source, so their
   * containers are intentionally absent and only the infrastructure containers exist.
   */
  localApplicationServices?: readonly string[];
  onLocalApplicationStopping?: () => void;
  preferredPort?: number;
  enableDailySession?: boolean;
  /** Set when a presentation owns the terminal; diagnostics then stay off stdout. */
  terminal?: LocalTerminalOutput;
}

/** Owns the concrete local-server startup boundary used by the CLI command. */
export class LocalAgentServerStarter {
  public start(options: ServerCommandOptions = {}): Promise<LocalAgentServerRuntime> {
    return new LocalAgentServerBootstrap({
      host: 'localhost',
      ...(options.preferredPort !== undefined ? { preferredPort: options.preferredPort } : {}),
      ...(options.enableDailySession !== undefined
        ? { enableDailySession: options.enableDailySession }
        : {}),
      ...(options.terminal ? { terminal: options.terminal } : {}),
    }).start();
  }
}

/** Owns process signal listeners while the foreground server command is waiting. */
export class TerminationSignalWaiter {
  private pendingResolve: (() => void) | null = null;

  public wait(): Promise<void> {
    if (this.pendingResolve) {
      throw new Error('Already waiting for a termination signal.');
    }
    return new Promise<void>((resolve) => {
      this.pendingResolve = resolve;
      process.on('SIGINT', this.handleSignal);
      process.on('SIGTERM', this.handleSignal);
    });
  }

  public cancel(): void {
    this.handleSignal();
  }

  private readonly handleSignal = (): void => {
    process.off('SIGINT', this.handleSignal);
    process.off('SIGTERM', this.handleSignal);
    const resolve = this.pendingResolve;
    this.pendingResolve = null;
    resolve?.();
  };
}

type PairingRequiredOutcome = Extract<StartupReadinessOutcome, { kind: 'pairing-required' }>;

/**
 * How the foreground server command presents startup, recovery and the wait
 * for exit. It never owns shutdown: `ServerCommand` closes the server once
 * `waitForExit` resolves or startup fails.
 */
export interface ServerCommandPresentation {
  /** Resolves true when the machine was paired again and startup may retry. */
  recoverPairing(outcome: PairingRequiredOutcome): Promise<boolean>;
  presentPlatformUnavailable(error: PlatformUnavailableStartupError): Promise<void>;
  presentStartupFailure(message: string): Promise<void>;
  serverStarted(server: LocalAgentServerRuntime): void;
  dispose?(): void;
  waitForExit(): Promise<void>;
}

/** The established line-oriented presentation used without an interactive terminal. */
class ConsoleServerCommandPresentation implements ServerCommandPresentation {
  private readonly terminationSignals = new TerminationSignalWaiter();
  private readonly pairingRecovery: PairingRequiredStartupRecovery;
  private readonly platformUnavailablePresenter: PlatformUnavailableStartupPresenter;

  public constructor(private readonly output: Pick<Console, 'log' | 'error'> = console) {
    this.pairingRecovery = new PairingRequiredStartupRecovery(output);
    this.platformUnavailablePresenter = new PlatformUnavailableStartupPresenter(output);
  }

  public recoverPairing(outcome: PairingRequiredOutcome): Promise<boolean> {
    return this.pairingRecovery.recover(outcome);
  }

  public presentPlatformUnavailable(error: PlatformUnavailableStartupError): Promise<void> {
    return this.platformUnavailablePresenter.present(error);
  }

  public presentStartupFailure(message: string): Promise<void> {
    this.output.error(`Failed to run local agent server: ${message}`);
    return Promise.resolve();
  }

  public serverStarted(server: LocalAgentServerRuntime): void {
    this.output.log(`Local agent server started at ${server.url}. Press Ctrl+C to stop.`);
  }

  public waitForExit(): Promise<void> {
    return this.terminationSignals.wait();
  }

  public dispose(): void {
    this.terminationSignals.cancel();
  }
}

/** Owns the foreground server command lifecycle from startup through shutdown. */
export class ServerCommand {
  private readonly serverStarter: LocalAgentServerStarter;
  private readonly presentation: ServerCommandPresentation;

  public constructor(
    output: Pick<Console, 'log' | 'error'> = console,
    presentation?: ServerCommandPresentation,
  ) {
    this.serverStarter = new LocalAgentServerStarter();
    this.presentation = presentation ?? new ConsoleServerCommandPresentation(output);
  }

  public async run(options: ServerCommandOptions = {}): Promise<boolean> {
    let localServer: LocalAgentServerRuntime | null = null;
    let localBridge: LocalBridgeLifecycle | undefined;
    const start = async () => {
      if (!options.localApplicationDirectory) {
        return this.serverStarter.start(options);
      }
      const owners = new LocalLifecycleOwners(
        new InstallationStore(options.localApplicationDirectory),
      );
      return owners.exclusive(async () => {
        const installation = await owners.storage.read();
        if (
          !installation ||
          !options.localApplicationRelease ||
          !sameRelease(installation.release, options.localApplicationRelease)
        ) {
          throw new Error(
            'Local release changed before connection. Run heyhey local again to review the matching release.',
          );
        }
        const update = await owners.storage.updateConsent();
        if (update && !sameRelease(update.target, options.localApplicationRelease)) {
          throw new Error(
            `A coordinated update to CLI ${update.target.cliVersion} is pending. Run heyhey local with that release to finish it before connecting.`,
          );
        }
        const docker = new DockerBoundary();
        const observed = await docker.inspect();
        assertObservedRelease(observed, options.localApplicationRelease);
        const expectedServices = options.localApplicationServices ?? Object.keys(SERVICE_IMAGES);
        if (
          observed.length !== expectedServices.length ||
          observed.some((container) => !container.State.Running)
        ) {
          throw new Error('Local application stopped before connection. Run heyhey local again.');
        }
        await docker.health([...expectedServices]);
        const server = await this.serverStarter.start(options);
        try {
          localBridge = await owners.register(server, options.onLocalApplicationStopping);
          return server;
        } catch (error) {
          await server.close();
          throw error;
        }
      });
    };
    try {
      try {
        localServer = await start();
      } catch (error) {
        if (
          !(error instanceof StartupReadinessError) ||
          error.outcome.kind !== 'pairing-required'
        ) {
          throw error;
        }
        const recovered = await this.presentation.recoverPairing(error.outcome);
        if (!recovered) return false;
        localServer = await start();
      }
      this.presentation.serverStarted(localServer);
      await (localBridge
        ? Promise.race([this.presentation.waitForExit(), localServer.whenClosed])
        : this.presentation.waitForExit());
      return true;
    } catch (error) {
      if (error instanceof PlatformUnavailableStartupError) {
        await this.presentation.presentPlatformUnavailable(error);
        return true;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.presentation.presentStartupFailure(message);
      return false;
    } finally {
      this.presentation.dispose?.();
      if (localServer) {
        try {
          if (localBridge) {
            await localBridge.stop();
          } else {
            await localServer.close();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.presentation.presentStartupFailure(
            `Bridge cleanup failed: ${message}. New work is blocked. ` +
              'Keep this terminal open and run heyhey local stop in another terminal to retry.',
          );
          if (!localBridge) {
            throw error;
          }
          // Keep the owner reachable until a lifecycle command completes cleanup.
          await localServer.whenClosed;
        }
      }
      await localBridge?.close();
    }
  }
}
