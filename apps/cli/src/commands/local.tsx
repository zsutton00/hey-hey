import type { ReleaseManifest } from '../release/release-manifest';
import { LOCAL_WEB_ORIGIN, LOCAL_WEB_RP_ID } from '../local-app/compose';
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
import { DockerBoundary } from '../local-app/docker-boundary';
import { openBrowser } from '../local-app/open-browser';
import { buildInjectedCredential, getActiveCredentialKey } from '../auth/index';
import { CredentialStore } from '../credentials/store';
import { KeyPairStore } from '../credentials/index';
import { runPairCommand } from './pair';
import { LocalApprovalSecret } from '../auth/local-approval';
import { PairServerCommand } from './pair-server';
import { resolvePairingUrl } from './pairing-web-url';
import { CodingAgentDetector } from '../local-app/coding-agent-detection';
import type { LocalCodingAgentDetectionDto } from '../shared/api/index';
import { z } from 'zod';
import { createInterface, type Interface } from 'node:readline';
import type { MachineEnrollmentCeremonyStep } from '../auth/machine-enrollment-ceremony';

// The API wraps every success in the standard ApiResponse envelope; only `data` is ours to validate.
const localBootstrapResponseSchema = z.object({
  data: z.strictObject({
    handoffToken: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
    expiresInSeconds: z.literal(120),
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
  localApproval: LocalApprovalSecret;
  agents: LocalCodingAgentDetectionDto;
}

/** Secrets ride only in the fragment, which browsers never send to a server. */
const localWebUrl = (handoffToken?: string, pairing?: LocalPairingHandoff): string => {
  const url = new URL('/local', LOCAL_WEB_ORIGIN);
  const fragment = new URLSearchParams();
  if (pairing) {
    url.searchParams.set('pairing', 'started');
    fragment.set('code', pairing.userCode);
    fragment.set('approval', pairing.localApproval.fragmentValue);
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

  await openBrowser(target).catch(() => {
    console.error(failure);
  });
}

async function createLocalHandoff(installationSecret: string): Promise<string> {
  const response = await fetch('http://localhost:3000/api/v1/auth/local/bootstrap', {
    method: 'POST',
    headers: { 'X-HeyHey-Local-Secret': installationSecret },
  });
  if (!response.ok) {
    throw new Error(`Local account access could not be prepared (HTTP ${response.status}).`);
  }
  const payload = localBootstrapResponseSchema.parse(JSON.parse(await response.text()));
  return payload.data.handoffToken;
}

/** The local application has no login: the installation secret is the CLI's proof of authority. */
async function storeLocalCliCredentials(installationSecret: string): Promise<void> {
  const response = await fetch('http://localhost:3000/api/v1/auth/local/cli-credentials', {
    method: 'POST',
    headers: { 'X-HeyHey-Local-Secret': installationSecret },
  });
  if (!response.ok) {
    throw new Error(`Local CLI access could not be prepared (HTTP ${response.status}).`);
  }
  const { data } = localCliCredentialsResponseSchema.parse(JSON.parse(await response.text()));
  const credential = buildInjectedCredential({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
  await new CredentialStore().store(getActiveCredentialKey(), credential);
}

/**
 * While pairing waits for the browser, Enter reopens the pairing page, so a closed
 * tab is not a dead end. Each reopen carries a fresh handoff token because the
 * first one expires after two minutes. It stops listening as soon as the ceremony
 * moves on, so it never competes with the terminal confirmation prompt.
 */
class LocalPairingPageReopener {
  private userCode: string | null = null;
  private lines: Interface | null = null;

  constructor(
    private readonly installationSecret: string,
    private readonly localApproval: LocalApprovalSecret,
    private readonly agents: LocalCodingAgentDetectionDto,
  ) {}

  follow(step: MachineEnrollmentCeremonyStep): void {
    if (step.kind === 'browser-handoff') {
      this.userCode = step.userCode;
      return;
    }
    if (step.kind === 'waiting-for-browser' && this.userCode) {
      this.listen();
      return;
    }
    this.stop();
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
      const handoffToken = await createLocalHandoff(this.installationSecret);
      const pairing = {
        userCode: this.userCode,
        localApproval: this.localApproval,
        agents: this.agents,
      };
      await openLocalPage(
        localWebUrl(handoffToken, pairing),
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
  onStopping: () => void,
): Promise<boolean> {
  const originalApiUrl = process.env['HEYHEY_API_URL'];
  const originalWebOrigin = process.env['HEYHEY_WEB_ORIGIN'];
  const originalControllerOrigin = process.env['HEYHEY_CONTROLLER_ORIGIN'];
  const originalControllerRpId = process.env['HEYHEY_CONTROLLER_RP_ID'];
  process.env['HEYHEY_API_URL'] = 'http://localhost:3000';
  process.env['HEYHEY_WEB_ORIGIN'] = LOCAL_WEB_ORIGIN;
  // Passkey assertions come from the local web app, so the CLI must expect exactly that origin.
  // An explicit value still wins.
  process.env['HEYHEY_CONTROLLER_ORIGIN'] ??= LOCAL_WEB_ORIGIN;
  process.env['HEYHEY_CONTROLLER_RP_ID'] ??= LOCAL_WEB_RP_ID;

  try {
    const secrets = await storage.secrets();
    const handoffToken = await createLocalHandoff(secrets.admin);
    await storeLocalCliCredentials(secrets.admin);
    const keyPairStore = new KeyPairStore();
    const currentMachineId = await keyPairStore.loadCurrentMachineId();
    console.log(
      `Pairing state: keychain namespace "${keyPairStore.getAccountNamespace()}", current machine ID ${currentMachineId ?? 'none'}. ${
        currentMachineId
          ? 'Treating this computer as already paired; no new pairing will be started.'
          : 'Starting a first-time pairing.'
      }`,
    );
    if (currentMachineId) {
      await openLocalPage(
        localWebUrl(handoffToken),
        'Could not open the local setup page automatically.',
      );
      return await new PairServerCommand().runServerAfterPairing({
        localApplicationDirectory: storage.directory,
        localApplicationRelease: release,
        localApplicationNavigation: navigation,
        preferredPort: bridgePort,
        onLocalApplicationStopping: onStopping,
      });
    }

    const localApproval = new LocalApprovalSecret();
    const agents = await new CodingAgentDetector().detect();
    const reopener = new LocalPairingPageReopener(secrets.admin, localApproval, agents);
    const paired = await runPairCommand({
      keyPairStore,
      localApproval,
      // The printed fallback carries the code but never the approval secret.
      getPairingUrl: (userCode) => resolvePairingUrl(userCode),
      onBrowserHandoff: (userCode) => {
        void openLocalPage(
          localWebUrl(handoffToken, { userCode, localApproval, agents }),
          'Could not open the local pairing page automatically.',
        );
      },
      onCeremonyStep: (step) => {
        reopener.follow(step);
      },
    }).finally(() => {
      reopener.stop();
    });
    if (!paired) {
      return false;
    }
    return await new PairServerCommand().runServerAfterPairing({
      localApplicationDirectory: storage.directory,
      localApplicationRelease: release,
      localApplicationNavigation: navigation,
      preferredPort: bridgePort,
      onLocalApplicationStopping: onStopping,
    });
  } finally {
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
        void (state.kind === 'stop'
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
        if (state.kind === 'update') {
          void application.declineUpdate();
        } else {
          application.cancel();
        }
      }}
    />
  );
}

export async function runLocalCommand(args: string[]): Promise<boolean> {
  if (args.length === 1 && args[0] === 'dev') {
    const { runLocalDevCommand } = await import('./local-dev');
    return runLocalDevCommand();
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
    process.env['HEYHEY_LOCAL_MODEL_DIR'] ?? '',
    process.platform,
    packages,
  );
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await (stopping ? application.requestStop() : application.run());
    const state = application.state;
    console.log(
      state.kind === 'ready'
        ? `${state.url}\nReconnect: heyhey local\nStop application: heyhey local stop`
        : state.kind === 'recovery' || state.kind === 'prerequisite'
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
      () => {
        applicationStopping = true;
      },
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
