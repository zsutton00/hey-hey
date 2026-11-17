import { StartupBrowserDiagnostics } from '../local-app/startup-browser-diagnostics';
import { StartupDiagnostics } from '../local-app/startup-diagnostics';
import { StructuredServerLogger } from '../server/logger';
import type { ReleaseManifest } from '../release/release-manifest';
import { LOCAL_WEB_RP_ID, localWebOrigin } from '../local-app/compose';
import { ReleasePackage } from '../local-app/release-package';
import { useEffect, useState } from 'react';
import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { version } from '../../package.json';
import { loadInk } from '../tui/ink';
import { LocalScreen } from '../local-app/LocalScreen';
import { LocalApplication, type LocalApplicationNavigation } from '../local-app/local-application';
import { ReleaseSource } from '../local-app/release-source';
import { InstallationStore } from '../local-app/installation-store';
import { ModelDownloader } from '../local-app/model-downloader';
import { DockerBoundary } from '../local-app/docker-boundary';
import { openBrowser } from '../local-app/open-browser';
import { buildInjectedCredential } from '../auth/index';
import { LocalCliState } from '../local-app/local-cli-state';
import { MachineControllerAuthority } from '../auth/machine-controller-authority';
import { Configuration, MachinesApi } from '../shared/api';
import { createDefaultMachineEnrollmentClient } from '../auth/machine-enrollment-client';
import { createDefaultMachineControllerManagementClient } from '../auth/machine-controller-management';
import { runPairCommand } from './pair';
import { LocalApprovalSecret } from '../auth/local-approval';
import { createInteractivePrompter } from '../agent-runtime/credentials/cli/interactivePrompt';
import { LocalPasskeyRepair, type TerminalReader } from '../local-app/local-passkey-repair';
import { PairServerCommand } from './pair-server';
import { resolvePairingUrl } from './pairing-web-url';
import { CodingAgentDetector } from '../local-app/coding-agent-detection';
import type { LocalCodingAgentDetectionDto } from '../shared/api/index';
import { z } from 'zod';
import { createInterface, type Interface } from 'node:readline';
import type { MachineEnrollmentCeremonyStep } from '../auth/machine-enrollment-ceremony';
import { isCredentialError } from '../credentials/errors';
import { describeProtectedStorageProblem } from '../credentials/storage-guidance';

// The API wraps every success in the standard ApiResponse envelope; only `data` is ours to validate.
const localBootstrapResponseSchema = z.object({
  data: z.strictObject({
    handoffToken: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
    expiresInSeconds: z.literal(120),
    accountHasPasskey: z.boolean(),
  }),
});

const localCliCredentialsResponseSchema = z.object({
  data: z.strictObject({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresInSeconds: z.number().int().positive(),
  }),
});

interface LocalPairingHandoff {
  userCode: string;
  /** Present only for a genuine first passkey; any later pairing is confirmed at the terminal. */
  localApproval?: LocalApprovalSecret;
  agents: LocalCodingAgentDetectionDto;
}

/** Secrets ride only in the fragment, which browsers never send to a server. */
const localWebUrl = (
  webOrigin: string,
  handoffToken?: string,
  pairing?: LocalPairingHandoff,
): string => {
  const url = new URL('/local', webOrigin);
  const fragment = new URLSearchParams();
  if (pairing) {
    url.searchParams.set('pairing', 'started');
    fragment.set('code', pairing.userCode);
    if (pairing.localApproval) {
      fragment.set('approval', pairing.localApproval.fragmentValue);
    }
    fragment.set('agents', JSON.stringify(pairing.agents));
  }
  if (handoffToken) {
    fragment.set('handoff', handoffToken);
  }
  url.hash = fragment.toString();
  return url.toString();
};

/** Opens the local page and says what it carried, by length only, so a missing value is visible. */
async function openLocalPage(target: string, failure: string): Promise<void> {
  const url = new URL(target);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const carried = ['handoff', 'code', 'approval', 'agents'].map(
    (key) => `${key}=${fragment.get(key)?.length ?? 'absent'}`,
  );
  console.log(`Opening ${url.origin}${url.pathname}${url.search} fragment[${carried.join(' ')}]`);

  const logger = new StructuredServerLogger();
  logger.debug('local.browser.open', { outcome: 'requested' });
  try {
    await openBrowser(target);
    logger.debug('local.browser.open', { outcome: 'opened' });
  } catch (error) {
    logger.error('local.browser.open', { outcome: 'failed', error });
    console.error(failure);
  }
}

interface LocalHandoff {
  handoffToken: string;
  /** The local account already has a live passkey, so this is not a first-time setup. */
  accountHasPasskey: boolean;
}

async function createLocalHandoff(installationSecret: string): Promise<LocalHandoff> {
  const response = await fetch('http://localhost:3000/api/v1/auth/local/bootstrap', {
    method: 'POST',
    headers: { 'X-HeyHey-Local-Secret': installationSecret },
  });
  if (!response.ok) {
    throw Object.assign(
      new Error(`Local account access could not be prepared (HTTP ${response.status}).`),
      { status: response.status },
    );
  }
  const payload = localBootstrapResponseSchema.parse(JSON.parse(await response.text()));
  return payload.data;
}

/** The local application has no login: the installation secret is the CLI's proof of authority. */
async function storeLocalCliCredentials(
  installationSecret: string,
  state: LocalCliState,
): Promise<void> {
  const response = await fetch('http://localhost:3000/api/v1/auth/local/cli-credentials', {
    method: 'POST',
    headers: { 'X-HeyHey-Local-Secret': installationSecret },
  });
  if (!response.ok) {
    throw Object.assign(
      new Error(`Local CLI access could not be prepared (HTTP ${response.status}).`),
      { status: response.status },
    );
  }
  const { data } = localCliCredentialsResponseSchema.parse(JSON.parse(await response.text()));
  const credential = buildInjectedCredential({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
  await state.credentials.store('heyhey:oauth:local-application', credential);
}

/**
 * While pairing waits for the browser, Enter reopens the pairing page, so a closed
 * tab is not a dead end. Each reopen carries a fresh handoff token because the
 * first one expires after two minutes. It stops listening as soon as the ceremony
 * moves on, so it never competes with the terminal confirmation prompt.
 */
class LocalPairingPageReopener implements TerminalReader {
  private userCode: string | null = null;
  private lines: Interface | null = null;
  private waitingForBrowser = false;

  constructor(
    private readonly installationSecret: string,
    private readonly localApproval: LocalApprovalSecret | undefined,
    private readonly agents: LocalCodingAgentDetectionDto,
    private readonly webOrigin: string,
    private readonly browserDiagnostics?: StartupBrowserDiagnostics,
  ) {}

  follow(step: MachineEnrollmentCeremonyStep): void {
    if (step.kind === 'browser-handoff') {
      this.userCode = step.userCode;
      return;
    }
    this.waitingForBrowser = step.kind === 'waiting-for-browser' && this.userCode !== null;
    if (this.waitingForBrowser) {
      this.listen();
      return;
    }
    this.stop();
  }

  /** Another prompt needs the terminal; Enter must not reopen the page meanwhile. */
  pause(): void {
    this.stop();
  }

  resume(): void {
    if (this.waitingForBrowser) {
      this.listen();
    }
  }

  stop(): void {
    this.lines?.close();
    this.lines = null;
  }

  private listen(): void {
    if (this.lines || !process.stdin.isTTY) {
      return;
    }

    console.log('Closed the pairing page? Press Enter to open it again.');
    this.lines = createInterface({ input: process.stdin });
    this.lines.on('line', () => {
      void this.reopen();
    });
  }

  private async reopen(): Promise<void> {
    if (!this.userCode) {
      return;
    }

    try {
      const { handoffToken } = await createLocalHandoff(this.installationSecret);
      const pairing = {
        userCode: this.userCode,
        ...(this.localApproval ? { localApproval: this.localApproval } : {}),
        agents: this.agents,
      };
      await openLocalPage(
        this.browserDiagnostics?.decorate(localWebUrl(this.webOrigin, handoffToken, pairing)) ??
          localWebUrl(this.webOrigin, handoffToken, pairing),
        'Could not open the local pairing page automatically.',
      );
    } catch (error: unknown) {
      console.error(error instanceof Error ? error.message : String(error));
    }
  }
}

function restoreEnvironment(name: string, original: string | undefined): void {
  if (original === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = original;
  }
}

export async function continueLocalApplication(
  storage: InstallationStore,
  release: ReleaseManifest,
  navigation: LocalApplicationNavigation,
  bridgePort: number,
  webPort: number,
  onStopping: () => void,
  /** Dev mode only: the containers expected to be running. See `ServerCommandOptions`. */
  expectedServices?: readonly string[],
  state = new LocalCliState(storage.directory),
  diagnostics?: StartupDiagnostics,
): Promise<boolean> {
  const serverServices = expectedServices ? { localApplicationServices: expectedServices } : {};
  const originalApiUrl = process.env['HEYHEY_API_URL'];
  const originalWebOrigin = process.env['HEYHEY_WEB_ORIGIN'];
  const originalControllerOrigin = process.env['HEYHEY_CONTROLLER_ORIGIN'];
  const originalControllerRpId = process.env['HEYHEY_CONTROLLER_RP_ID'];
  process.env['HEYHEY_API_URL'] = 'http://localhost:3000';
  const webOrigin = localWebOrigin(webPort);
  process.env['HEYHEY_WEB_ORIGIN'] = webOrigin;
  // Passkey assertions come from the local web app, so the CLI must expect exactly that origin.
  // An explicit value still wins.
  process.env['HEYHEY_CONTROLLER_ORIGIN'] ??= webOrigin;
  process.env['HEYHEY_CONTROLLER_RP_ID'] ??= LOCAL_WEB_RP_ID;

  const logger = new StructuredServerLogger();
  const browserDiagnostics = diagnostics
    ? new StartupBrowserDiagnostics(diagnostics, webOrigin)
    : undefined;
  await browserDiagnostics?.start();
  const browserUrl = (target: string) => browserDiagnostics?.decorate(target) ?? target;
  try {
    try {
      logger.debug('local.protected_storage', { outcome: 'checking' });
      await state.keyPairStore.ensureProtectedStorageReady();
      logger.debug('local.protected_storage', { outcome: 'ready' });
    } catch (error) {
      logger.error('local.protected_storage', { outcome: 'failed', error });
      diagnostics?.failure();
      console.error(
        `[local] protected_storage_not_ready code=${
          isCredentialError(error) ? error.code : 'UNKNOWN'
        } reason=${error instanceof Error ? error.message : String(error)}`,
      );
      console.error(describeProtectedStorageProblem(error));
      return false;
    }
    const secrets = await storage.secrets();
    const { handoffToken } = await createLocalHandoff(secrets.admin);
    await storeLocalCliCredentials(secrets.admin, state);
    const keyPairStore = state.keyPairStore;
    const readAccessToken = async (): Promise<string> => {
      const token = await state.oauthClient.getAccessToken();
      if (!token.success) {
        throw new Error(`Local CLI credentials unavailable: ${token.error}`);
      }
      return token.data;
    };
    const machines = new MachinesApi(
      new Configuration({
        basePath: 'http://localhost:3000/api/v1',
        accessToken: readAccessToken,
      }),
    );
    const managementClient = createDefaultMachineControllerManagementClient(
      keyPairStore,
      state.oauthClient,
    );
    const authority = new MachineControllerAuthority({
      keyPairStore,
      controllerRegistryStore: state.controllerRegistryStore,
      executionGrantStore: state.executionGrantStore,
      machineDirectory: machines,
      managementClient,
    });
    const readiness = await authority.readReadiness();
    logger.debug('local.pairing.readiness', { state: readiness.state });
    const currentMachineId = await keyPairStore.loadCurrentMachineId();
    console.log(
      `Pairing state: store=heyhey-local-cli state=${readiness.state} machineId=${currentMachineId ?? 'none'}.`,
    );
    const pairLocal = async (): Promise<boolean> => {
      const agents = await new CodingAgentDetector().detect();
      const current = await authority.readReadiness();
      const pairingHandoff = await createLocalHandoff(secrets.admin);
      // Only a genuine first passkey may approve itself. Once the account has a
      // passkey, the browser proves with it (or asks for Repair) and the person
      // confirms here, so no pairing-time grant is created.
      const localApproval = pairingHandoff.accountHasPasskey
        ? undefined
        : new LocalApprovalSecret();
      console.log(
        `Local pairing: state=${current.state} accountHasPasskey=${String(pairingHandoff.accountHasPasskey)} approval=${localApproval ? 'first-passkey' : 'terminal-confirmation'}.`,
      );
      if (pairingHandoff.accountHasPasskey) {
        console.log(
          'This computer was set up before. Use your existing passkey in the page that opens, then confirm here.',
        );
      }
      const pairing = { ...(localApproval ? { localApproval } : {}), agents };
      const reopener = new LocalPairingPageReopener(
        secrets.admin,
        localApproval,
        agents,
        webOrigin,
        browserDiagnostics,
      );
      const prompter = createInteractivePrompter();
      const repair = new LocalPasskeyRepair(secrets.admin, prompter, reopener);
      if (pairingHandoff.accountHasPasskey) {
        await repair.watch();
      }

      return runPairCommand({
        keyPairStore,
        controllerRegistryStore: state.controllerRegistryStore,
        executionGrantStore: state.executionGrantStore,
        machinesApi: createDefaultMachineEnrollmentClient(await readAccessToken()),
        existingMachineClient: managementClient,
        ...(current.state === 'machine-unrecognized' && current.machineId
          ? { replaceUnrecognizedMachineId: current.machineId }
          : {}),
        ...(localApproval ? { localApproval } : {}),
        prompter,
        getPairingUrl: (userCode) => resolvePairingUrl(userCode),
        onBrowserHandoff: (userCode) => {
          void openLocalPage(
            browserUrl(
              localWebUrl(webOrigin, pairingHandoff.handoffToken, { userCode, ...pairing }),
            ),
            'Could not open the local pairing page automatically.',
          );
        },
        onCeremonyStep: (step) => {
          logger.debug('local.pairing.step', {
            state: step.kind,
            ...(step.kind === 'finished' ? { outcome: step.outcome } : {}),
          });
          reopener.follow(step);
        },
      }).finally(() => {
        repair.stop();
        reopener.stop();
      });
    };
    if (readiness.state === 'ready') {
      await openLocalPage(
        browserUrl(localWebUrl(webOrigin, handoffToken)),
        'Could not open the local setup page automatically.',
      );
      return await new PairServerCommand().runServerAfterPairing({
        state,
        recoverPairing: pairLocal,
        localApplicationDirectory: storage.directory,
        localApplicationRelease: release,
        ...serverServices,
        localApplicationNavigation: navigation,
        preferredPort: bridgePort,
        onLocalApplicationStopping: onStopping,
      });
    }

    const paired = await pairLocal();
    if (!paired) {
      return false;
    }
    return await new PairServerCommand().runServerAfterPairing({
      state,
      recoverPairing: pairLocal,
      localApplicationDirectory: storage.directory,
      localApplicationRelease: release,
      ...serverServices,
      localApplicationNavigation: navigation,
      preferredPort: bridgePort,
      onLocalApplicationStopping: onStopping,
    });
  } finally {
    browserDiagnostics?.close();
    if (originalApiUrl === undefined) {
      delete process.env['HEYHEY_API_URL'];
    } else {
      process.env['HEYHEY_API_URL'] = originalApiUrl;
    }
    if (originalWebOrigin === undefined) {
      delete process.env['HEYHEY_WEB_ORIGIN'];
    } else {
      process.env['HEYHEY_WEB_ORIGIN'] = originalWebOrigin;
    }
    restoreEnvironment('HEYHEY_CONTROLLER_ORIGIN', originalControllerOrigin);
    restoreEnvironment('HEYHEY_CONTROLLER_RP_ID', originalControllerRpId);
  }
}

function LocalRoot({
  application,
  done,
  stopping,
}: {
  application: LocalApplication;
  done: () => void;
  stopping: boolean;
}): React.JSX.Element {
  const [state, setState] = useState(application.state);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const change = () => {
      setState(application.state);
      setSelected(0);
    };
    application.on('change', change);
    void (stopping ? application.requestStop() : application.run());
    return () => {
      application.off('change', change);
    };
  }, [application, stopping]);
  useEffect(() => {
    if (['ready', 'cancelled', 'stopped', 'update-restart'].includes(state.kind)) {
      done();
    }
  }, [state, done]);
  return (
    <LocalScreen
      state={state}
      selected={selected}
      onSelect={setSelected}
      onConfirm={() => {
        void (state.kind === 'docker-repair'
          ? application.confirmDockerRepair()
          : state.kind === 'stop'
            ? application.confirmStop()
            : state.kind === 'update'
              ? application.acceptUpdate()
              : state.kind === 'installation'
                ? application.install()
                : stopping
                  ? application.requestStop()
                  : application.retry());
      }}
      onCancel={() => {
        if (state.kind === 'docker-repair') {
          application.declineDockerRepair();
        } else if (state.kind === 'update') {
          void application.declineUpdate();
        } else {
          application.cancel();
        }
      }}
    />
  );
}

async function runLocalAttempt(args: string[], diagnostics: StartupDiagnostics): Promise<boolean> {
  if (args.length === 1 && args[0] === 'dev') {
    const { runLocalDevCommand } = await import('./local-dev');
    return runLocalDevCommand(diagnostics);
  }
  const stopping = args.length === 1 && args[0] === 'stop';
  if (args.length > 0 && !stopping) {
    console.error('Usage: heyhey local [stop]');
    return false;
  }
  const packages = new ReleasePackage();
  const storage = new InstallationStore(join(homedir(), '.heyhey', 'local-application'));
  const application = new LocalApplication(
    new ReleaseSource(
      join(dirname(await realpath(process.argv[1] ?? '')), '..', 'release-manifest.json'),
      version,
    ),
    storage,
    new DockerBoundary(),
    new ModelDownloader(),
    process.platform,
    packages,
    undefined,
    undefined,
    diagnostics,
  );
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await (stopping ? application.requestStop() : application.run());
    const state = application.state;
    console.log(
      state.kind === 'ready'
        ? `${state.url}\nReconnect: heyhey local\nStop application: heyhey local stop`
        : state.kind === 'recovery' ||
            state.kind === 'prerequisite' ||
            state.kind === 'docker-repair'
          ? state.message
          : 'Run heyhey local in an interactive terminal to review installation, update or shutdown choices.',
    );
    await packages.dispose();
    return state.kind === 'ready';
  }
  const { render } = await loadInk();
  const instance = render(
    <LocalRoot application={application} stopping={stopping} done={() => instance.unmount()} />,
  );
  await instance.waitUntilExit();
  await packages.dispose();
  if (application.state.kind !== 'ready') {
    if (application.state.kind === 'stopped') {
      console.log(
        `Local Hey Hey stopped. Your local data was kept. Start again: ${application.state.restartCommand}`,
      );
    }
    if (application.state.kind === 'update-restart') {
      console.log(
        `CLI ${application.state.version} installed. Run heyhey local to finish the matching-image update.`,
      );
    }
    return ['cancelled', 'stopped', 'update-restart'].includes(application.state.kind);
  }
  const navigation = application.state;
  const { url, reconnectCommand, stopCommand } = navigation;
  console.log(
    `Local Hey Hey: ${url}\nReconnect: ${reconnectCommand}\nStop application: ${stopCommand}`,
  );
  let applicationStopping = false;
  let bridgeStopped = false;
  try {
    bridgeStopped = await continueLocalApplication(
      storage,
      await application.releases.read(),
      application.state,
      application.bridgePort,
      application.webPort,
      () => {
        applicationStopping = true;
      },
      undefined,
      undefined,
      diagnostics,
    );
    return bridgeStopped;
  } finally {
    if (bridgeStopped && applicationStopping) {
      console.log('Agent bridge stopped by another local stop or update command.');
    } else if (bridgeStopped) {
      const exit = render(
        <LocalScreen
          state={{ ...navigation, kind: 'exited' }}
          selected={0}
          onSelect={() => undefined}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      exit.unmount();
      await exit.waitUntilExit();
    }
  }
}

/** Persistence starts before release discovery, Docker, credentials or the terminal UI. */
export async function runLocalCommand(args: string[]): Promise<boolean> {
  const diagnostics = new StartupDiagnostics(
    join(homedir(), '.heyhey', 'local-application', 'diagnostics'),
  );
  let success = false;
  try {
    success = await runLocalAttempt(args, diagnostics);
    if (!success) {
      diagnostics.failure();
    }
    return success;
  } catch (error) {
    new StructuredServerLogger().error('local.application.failure', {
      operation: 'startup',
      error,
    });
    diagnostics.failure();
    throw error;
  } finally {
    await diagnostics.finish(success ? 'success' : 'failed');
  }
}
