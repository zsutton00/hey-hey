/**
 * Interactive launch: the default `heyhey` in a terminal. Terminal ownership
 * is taken before the server starts so startup output reaches Debug, then the
 * existing foreground server command runs with the menu as its presentation.
 * Shutdown stays with that command; this module only presents and restores.
 */

import open from 'open';
import { pairMachine, resolvePairDependencies } from '../commands/pair';
import { resolvePairingUrl, resolvePairingWebOrigin } from '../commands/pairing-web-url';
import {
  ServerCommand,
  type ServerCommandOptions,
  type ServerCommandPresentation,
} from '../commands/server';
import { DiagnosticFeed } from '../server/diagnostic-feed';
import { createSaveFilePicker } from '../server/directory-picker';
import type { LocalAgentServerRuntime } from '../server/local-agent-server-runtime';
import { StructuredServerLogger, type ServerLogger } from '../server/logger';
import type { PlatformUnavailableStartupError } from '../server/startup-readiness';
import { resolveActiveProfile, resolveEnvironmentHost } from '../session/paths';
import { MachineOptionsStore } from '../options/machine-options-store';
import { SharedBrowserSource } from './browser-source';
import { loadInk, type Ink } from './ink';
import { readJevApiKey } from '../jev/client';
import { OptionsSource } from './options-source';
import { PresentationOwner } from './presentation-owner';
import type { RuntimeTarget } from './presentation-state';
import { PresentationRoot, RootErrorBoundary } from './root';
import { installTerminalCapture, type TerminalCapture } from './terminal-capture';

export const shouldUseColor = (env: NodeJS.ProcessEnv = process.env): boolean => {
  if (typeof env['NO_COLOR'] === 'string') return false;
  if (env['FORCE_COLOR'] === '0') return false;
  return env['TERM'] !== 'dumb';
};

/** Adapts the presentation owner to the server command's presentation seam. */
export class InteractiveServerPresentation implements ServerCommandPresentation {
  public constructor(
    private readonly owner: PresentationOwner,
    private readonly startupLogger: ServerLogger,
    private readonly terminationSignal: Promise<void>,
  ) {}

  public recoverPairing(): Promise<boolean> {
    const dependencies = resolvePairDependencies({
      logger: this.startupLogger.child({ component: 'pair-command' }),
      log: (message) => this.startupLogger.info('pair.progress', { message }),
      logError: (message) => this.startupLogger.warn('pair.progress', { message }),
    });
    return this.owner.recoverPairing((ports) => pairMachine(dependencies, ports));
  }

  public async presentPlatformUnavailable(error: PlatformUnavailableStartupError): Promise<void> {
    this.owner.presentStartupFailure(error.scenario.heading, error.scenario.body);
    await this.waitForExit();
  }

  public async presentStartupFailure(message: string): Promise<void> {
    this.owner.presentStartupFailure('Hey Hey could not start', message);
    await this.waitForExit();
  }

  public serverStarted(server: LocalAgentServerRuntime): void {
    this.owner.attach({
      ...server.presentationSources,
      sharedBrowser: new SharedBrowserSource(
        server.projectBrowsers,
        server.presentationSources.readProjectName,
        (event, details) => this.startupLogger.warn(event, details),
      ),
      options: new OptionsSource(
        new MachineOptionsStore(),
        readJevApiKey(process.env) !== undefined,
        (event, details) => this.startupLogger.warn(event, details),
      ),
    });
  }

  /** The user's quit (confirmed when work is active) or SIGTERM, whichever comes first. */
  public waitForExit(): Promise<void> {
    return Promise.race([this.owner.exitRequested, this.terminationSignal]);
  }
}

interface MountedPresentation {
  unmount(): void;
}

const mount = (
  inkModule: Ink,
  owner: PresentationOwner,
  capture: TerminalCapture,
  onRenderError: (error: Error) => void,
): MountedPresentation => {
  const instance = inkModule.render(
    <RootErrorBoundary onRenderError={onRenderError}>
      <PresentationRoot owner={owner} />
    </RootErrorBoundary>,
    {
      stdout: capture.rendererStdout,
      stdin: process.stdin,
      exitOnCtrlC: false,
      // Console capture is installed by TerminalCapture so it reaches Debug.
      patchConsole: false,
    },
  );
  let mounted = true;
  return {
    unmount: () => {
      if (!mounted) return;
      mounted = false;
      instance.unmount();
    },
  };
};

/** Read from the same values that choose the data folder, so the label always matches it. */
const resolveRuntimeTarget = (): RuntimeTarget => ({
  profile: resolveActiveProfile(),
  environment: resolveEnvironmentHost(),
});

export const runInteractiveServer = async (options: ServerCommandOptions): Promise<boolean> => {
  const diagnosticFeed = new DiagnosticFeed();
  const capture = installTerminalCapture(diagnosticFeed);
  // Startup logs before the server's own logger exists go to the same feed.
  const startupLogger = new StructuredServerLogger({
    sink: diagnosticFeed,
    writeLine: () => undefined,
  }).child({ component: 'terminal' });

  const owner = new PresentationOwner({
    diagnostics: diagnosticFeed,
    webOrigin: resolvePairingWebOrigin(),
    target: resolveRuntimeTarget(),
    pairingUrl: (userCode, route) => resolvePairingUrl(userCode, process.env, route),
    openUrl: async (url) => {
      await open(url);
    },
    chooseSaveFile: createSaveFilePicker(),
    report: (event, details) => startupLogger.warn(event, details),
    color: shouldUseColor(),
    viewport: { columns: process.stdout.columns, rows: process.stdout.rows },
  });

  let resolveTermination!: () => void;
  const terminationSignal = new Promise<void>((resolve) => {
    resolveTermination = resolve;
  });
  const onSigint = (): void => owner.interrupt();
  const onSigterm = (): void => resolveTermination();
  const onResize = (): void =>
    owner.resize({ columns: process.stdout.columns, rows: process.stdout.rows });
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  process.stdout.on('resize', onResize);

  let mounted: MountedPresentation | null = null;
  let restored = false;
  const restoreTerminal = (): void => {
    if (restored) return;
    restored = true;
    mounted?.unmount();
    capture.restore();
  };

  try {
    const inkModule = await loadInk();
    mounted = mount(inkModule, owner, capture, (error) => {
      startupLogger.error('terminal.render_failed', { error });
      owner.detachInteractive();
      // Unmount after React finishes the failed commit; Runs and the server keep going.
      setImmediate(() => {
        restoreTerminal();
        process.stderr.write(
          `The Hey Hey terminal view stopped after an error (${error.message}). ` +
            'Hey Hey is still running; press Ctrl+C to stop it.\n',
        );
      });
    });
    return await new ServerCommand(
      console,
      new InteractiveServerPresentation(owner, startupLogger, terminationSignal),
    ).run({
      ...options,
      terminal: { diagnosticFeed, writeLogLine: () => undefined },
    });
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.stdout.off('resize', onResize);
    owner.dispose();
    restoreTerminal();
  }
};
