import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  DEV_INFRASTRUCTURE_ENDPOINTS,
  LOCAL_AGENT_PORT_VARIABLE,
  LOCAL_WEB_ORIGIN,
  devComposeConfiguration,
  localApiEnvironment,
  provisioningSql,
} from '../local-app/compose';
import { DockerBoundary } from '../local-app/docker-boundary';
import { InstallationStore, checkModels } from '../local-app/installation-store';
import { LocalLifecycleOwners } from '../local-app/lifecycle-owners';
import { assertObservedRelease } from '../local-app/local-application';
import { resolveLocalBridgePort } from '../local-app/local-port';
import { continueLocalApplication } from './local';

const INFRASTRUCTURE = ['postgres', 'redis', 'graph-search'];

/** This file sits at apps/cli/src/commands; dev mode only exists in a source checkout. */
function checkoutRoot(): string {
  const root = resolve(__dirname, '..', '..', '..', '..');
  for (const app of ['api', 'ui']) {
    if (!existsSync(join(root, 'apps', app, 'package.json'))) {
      throw new Error('heyhey local dev runs only from a Hey Hey source checkout (pnpm dev:run).');
    }
  }
  return root;
}

/** Runs one app from source in its own process group, writing its output to a log file. */
function startFromSource(
  name: string,
  directory: string,
  args: string[],
  env: Record<string, string>,
  logDirectory: string,
): ChildProcess {
  const logPath = join(logDirectory, `${name}.log`);
  const log = createWriteStream(logPath, { flags: 'a' });
  const child = spawn('pnpm', ['--dir', directory, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  child.on('exit', (code, signal) => {
    console.error(`${name} from source exited (${signal ?? code}). See ${logPath}`);
  });
  console.log(`${name}: running from source, log ${logPath}`);
  return child;
}

function stopProcessGroup(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/**
 * Developer-only `heyhey local dev`: the installation's pinned PostgreSQL, Redis and graph/search
 * in containers, the API and UI from this checkout with hot reload, and this CLI attached as it
 * attaches to the installed application. Installation data and the paired machine are kept.
 */
export async function runLocalDevCommand(): Promise<boolean> {
  const root = checkoutRoot();
  const storage = new InstallationStore(join(homedir(), '.heyhey', 'local-application'));
  const docker = new DockerBoundary();
  const children: ChildProcess[] = [];
  let infrastructureStarted = false;

  try {
    if ((await docker.prerequisite()) !== 'ready') {
      throw new Error('Docker with Compose v2 must be installed and running.');
    }
    const installation = await storage.read();
    if (!installation) {
      throw new Error('No local installation found. Run heyhey local once to install it.');
    }
    const { release } = installation;
    await checkModels(installation.modelDirectory);
    const secrets = await storage.secrets();
    const bridgePort = resolveLocalBridgePort();

    await new LocalLifecycleOwners(storage).exclusive(async () => {
      const observed = await docker.inspect();
      assertObservedRelease(observed, release);

      const appServices = observed
        .map((container) => container.Config.Labels?.['com.docker.compose.service'] ?? '')
        .filter((service) => service === 'api' || service === 'ui');
      if (appServices.length > 0) {
        console.log('Removing the installed api and ui containers (data is kept)');
        await docker.removeContainers(storage.composePath, appServices);
      }

      const devPath = storage.devComposePath;
      await storage.writeCompose(
        devComposeConfiguration(
          installation,
          secrets,
          bridgePort,
          join(root, 'apps', 'api', 'db', 'flyway'),
        ),
        devPath,
      );
      console.log('Starting PostgreSQL and Redis');
      infrastructureStarted = true;
      await docker.startDatabase(devPath);
      await docker.provision(devPath, provisioningSql(secrets.api, secrets.graph));
      console.log("Migrating the database with this checkout's migrations");
      await docker.migrate(devPath, { outOfOrder: true });
    });

    const logDirectory = join(storage.directory, 'dev-logs');
    await mkdir(logDirectory, { recursive: true, mode: 0o700 });
    children.push(
      startFromSource(
        'api',
        join(root, 'apps', 'api'),
        ['dev'],
        localApiEnvironment(secrets, DEV_INFRASTRUCTURE_ENDPOINTS),
        logDirectory,
      ),
      startFromSource(
        'ui',
        join(root, 'apps', 'ui'),
        ['exec', 'vite', '--port', '5173', '--strictPort'],
        {
          NODE_ENV: 'development',
          // The browser calls the API directly, as the installed web app does, so origins match.
          VITE_API_URL: 'http://localhost:3000/api/v1',
          VITE_API_PROXY_TARGET: 'http://localhost:3000',
          [LOCAL_AGENT_PORT_VARIABLE]: String(bridgePort),
        },
        logDirectory,
      ),
    );

    console.log('Waiting for the API (graph/search starts once it serves signing keys)');
    await docker.health(['postgres', 'redis']);
    await docker.startGraphSearch(storage.devComposePath);
    await docker.health(INFRASTRUCTURE);
    assertObservedRelease(await docker.inspect(), release);

    const navigation = {
      url: `${LOCAL_WEB_ORIGIN}/local`,
      reconnectCommand: 'pnpm dev:run local dev',
      stopCommand: 'Ctrl+C',
    };
    console.log(`Local Hey Hey (dev mode): ${navigation.url}`);
    return await continueLocalApplication(
      storage,
      release,
      navigation,
      bridgePort,
      () => {},
      INFRASTRUCTURE,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'heyhey local dev failed.');
    return false;
  } finally {
    children.forEach(stopProcessGroup);
    if (infrastructureStarted) {
      console.log('Stopping dev-mode infrastructure (data is kept)');
      await docker.stop(storage.devComposePath).catch(() => {
        console.error('Could not stop the dev-mode containers; stop them in Docker Desktop.');
      });
    }
  }
}
