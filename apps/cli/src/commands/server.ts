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
    try {
      try {
        localServer = await this.serverStarter.start(options);
      } catch (error) {
        if (
          !(error instanceof StartupReadinessError) ||
          error.outcome.kind !== 'pairing-required'
        ) {
          throw error;
        }
        const recovered = await this.presentation.recoverPairing(error.outcome);
        if (!recovered) return false;
        localServer = await this.serverStarter.start(options);
      }
      this.presentation.serverStarted(localServer);
      await this.presentation.waitForExit();
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
      if (localServer) {
        await localServer.close().catch(() => undefined);
      }
    }
  }
}
