import { useEffect, useState } from 'react';
import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { version } from '../../package.json';
import { loadInk } from '../tui/ink';
import { LocalScreen } from '../local-app/LocalScreen';
import { LocalApplication } from '../local-app/local-application';
import { ReleaseSource } from '../local-app/release-source';
import { InstallationStore } from '../local-app/installation-store';
import { DockerBoundary } from '../local-app/docker-boundary';
import { openBrowser } from '../local-app/open-browser';
import { KeyPairStore } from '../credentials/index';
import { runPairCommand } from './pair';
import { PairServerCommand } from './pair-server';
import { z } from 'zod';

const localBootstrapResponseSchema = z.strictObject({
  data: z.strictObject({
    handoffToken: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
    expiresInSeconds: z.literal(120),
  }),
});

const localWebUrl = (pairingStarted = false, handoffToken?: string): string => {
  const url = new URL('http://localhost:5173/local');
  if (pairingStarted) {
    url.searchParams.set('pairing', 'started');
  }
  if (handoffToken) {
    url.hash = `handoff=${handoffToken}`;
  }
  return url.toString();
};

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

async function continueLocalApplication(storage: InstallationStore): Promise<boolean> {
  const originalApiUrl = process.env['HEYHEY_API_URL'];
  const originalWebOrigin = process.env['HEYHEY_WEB_ORIGIN'];
  process.env['HEYHEY_API_URL'] = 'http://localhost:3000';
  process.env['HEYHEY_WEB_ORIGIN'] = 'http://localhost:5173';

  try {
    const secrets = await storage.secrets();
    const handoffToken = await createLocalHandoff(secrets.admin);
    const keyPairStore = new KeyPairStore();
    const currentMachineId = await keyPairStore.loadCurrentMachineId();
    if (currentMachineId) {
      await openBrowser(localWebUrl(false, handoffToken)).catch(() => {
        console.error('Could not open the local setup page automatically.');
      });
      return await new PairServerCommand().runServerAfterPairing();
    }

    const paired = await runPairCommand({
      keyPairStore,
      getPairingUrl: () => localWebUrl(true),
      onBrowserHandoff: () => {
        void openBrowser(localWebUrl(true, handoffToken)).catch(() => {
          console.error('Could not open the local pairing page automatically.');
        });
      },
    });
    if (!paired) {
      return false;
    }
    return await new PairServerCommand().runServerAfterPairing();
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
  }
}

function LocalRoot({
  application,
  done,
}: {
  application: LocalApplication;
  done: () => void;
}): React.JSX.Element {
  const [state, setState] = useState(application.state);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const change = () => {
      setState(application.state);
      setSelected(0);
    };
    application.on('change', change);
    void application.run();
    return () => {
      application.off('change', change);
    };
  }, [application]);
  useEffect(() => {
    if (state.kind === 'ready' || state.kind === 'cancelled') {
      done();
    }
  }, [state, done]);
  return (
    <LocalScreen
      state={state}
      selected={selected}
      onSelect={setSelected}
      onConfirm={() => {
        void (state.kind === 'installation' ? application.install() : application.retry());
      }}
      onCancel={() => application.cancel()}
    />
  );
}

export async function runLocalCommand(args: string[]): Promise<boolean> {
  if (args.length > 0) {
    console.error('Usage: heyhey local');
    return false;
  }
  const application = new LocalApplication(
    new ReleaseSource(
      join(dirname(await realpath(process.argv[1] ?? '')), '..', 'release-manifest.json'),
      version,
    ),
    new InstallationStore(join(homedir(), '.heyhey', 'local-application')),
    new DockerBoundary(),
    process.env['HEYHEY_LOCAL_MODEL_DIR'] ?? '',
  );
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await application.run();
    const state = application.state;
    console.log(
      state.kind === 'ready'
        ? state.url
        : state.kind === 'recovery' || state.kind === 'prerequisite'
          ? state.message
          : 'Run heyhey local in an interactive terminal to consent to installation.',
    );
    return state.kind === 'ready';
  }
  const { render } = await loadInk();
  const instance = render(<LocalRoot application={application} done={() => instance.unmount()} />);
  await instance.waitUntilExit();
  if (application.state.kind !== 'ready') {
    return application.state.kind === 'cancelled';
  }
  return continueLocalApplication(
    new InstallationStore(join(homedir(), '.heyhey', 'local-application')),
  );
}
