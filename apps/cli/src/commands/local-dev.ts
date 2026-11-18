import type { StartupDiagnostics } from '../local-app/startup-diagnostics';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  DEV_INFRASTRUCTURE_ENDPOINTS,
  localWebOrigin,
  devWebEnvironment,
  devComposeConfiguration,
  localApiEnvironment,
  provisioningSql,
  LOCAL_PROJECT,
} from '../local-app/compose';
import { DockerBoundary } from '../local-app/docker-boundary';
import { InstallationStore, type Installation } from '../local-app/installation-store';
import { ModelDownloader } from '../local-app/model-downloader';
import { LocalLifecycleOwners } from '../local-app/lifecycle-owners';
import { assertNoOrphanedStorage, assertObservedRelease } from '../local-app/local-application';
import { LOCAL_RESET_CONFIRMATION, LocalReset } from '../local-app/local-reset';
import type { DownloadDetail } from '../local-app/pull-progress';
import { ReleasePackage } from '../local-app/release-package';
import { LocalKeyPairStore } from '../local-app/local-key-pair-store';
import { LocalCliState } from '../local-app/local-cli-state';
import { devWorkspace } from '../local-app/local-workspace';
import { resolveLocalBridgePort, resolveLocalWebPort } from '../local-app/local-port';
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

/**
 * First run on this computer: the installer's own installation record and secrets, pinned to the
 * latest published release's images. The package is only read for its manifest, never installed.
 */
async function installForDevelopment(
  storage: InstallationStore,
  docker: DockerBoundary,
): Promise<Installation> {
  await assertNoOrphanedStorage(docker, await docker.inspect());
  console.log('No local installation yet; creating one at ' + storage.directory);
  console.log(
    'Reading the pinned images of the latest published Hey Hey release (nothing is installed)',
  );
  const packages = new ReleasePackage();
  let release;
  try {
    release = await packages.latest();
  } finally {
    await packages.dispose();
  }
  console.log(`Using release ${release.cliVersion} for PostgreSQL, Redis and graph/search`);
  return storage.prepare(release);
}

/**
 * Fast fresh start: erases the dev workspace's account, projects, setup and this computer's dev
 * pairing through the reset's own targeting, keeping installation identity, images and model files.
 * The installed `heyhey local` is a different workspace and is never touched.
 */
async function freshStart(storage: InstallationStore): Promise<'cleared' | 'cancelled'> {
  if (!(await storage.read())) {
    console.log('No dev workspace yet; the first run is already a fresh start.');
    return 'cleared';
  }
  const reset = new LocalReset('fresh-start', true, devWorkspace());
  const plan = await reset.plan();
  reset.describe(plan).forEach((line) => console.log(line));

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question(
      `Type ${LOCAL_RESET_CONFIRMATION} to erase the listed targets: `,
    );
    if (answer !== LOCAL_RESET_CONFIRMATION) {
      console.log('Cancelled. Nothing was removed.');
      return 'cancelled';
    }
  } finally {
    terminal.close();
  }
  await reset.apply(plan);
  return 'cleared';
}

function printImageProgress(): (detail: DownloadDetail) => void {
  let shown = -1;
  return (detail) => {
    const step = detail.percent === null ? null : Math.floor(detail.percent / 10) * 10;
    if (step !== null && step > shown) {
      shown = step;
      console.log(`Downloading images ${String(step)}%`);
    }
  };
}

/**
 * The installed app publishes the API and web ports dev mode serves on, and may be running agent
 * work. Dev mode never stops it; it names the command that does and exits.
 */
async function assertInstalledApplicationStopped(): Promise<void> {
  const observed = await new DockerBoundary().inspect();
  const running = observed.filter((container) => container.State.Running);
  if (running.length > 0) {
    const services = running.map(
      (container) => container.Config.Labels?.['com.docker.compose.service'] ?? container.Id,
    );
    throw new Error(
      `The installed heyhey local's containers are running in Docker (${LOCAL_PROJECT}: ${services.join(', ')}) and use the same ports, even with no terminal open. Stop them with heyhey local stop (or pnpm dev:run local stop from apps/cli); their data is kept. Then retry.`,
    );
  }
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
 * Developer-only `heyhey local dev`: pinned PostgreSQL, Redis and graph/search in containers, the
 * API and UI from this checkout with hot reload, and this CLI attached as it attaches to the
 * installed application. It runs in its own workspace (folder, Docker project and volumes, and
 * keychain pairing), kept between dev runs and never shared with the installed `heyhey local`.
 */
export async function runLocalDevCommand(
  options: { fresh: boolean },
  diagnostics?: StartupDiagnostics,
): Promise<boolean> {
  const root = checkoutRoot();
  const workspace = devWorkspace();
  const storage = new InstallationStore(workspace.directory);
  const docker = new DockerBoundary(undefined, undefined, workspace.project);
  const children: ChildProcess[] = [];
  let infrastructureStarted = false;
  if (diagnostics) {
    diagnostics.dockerProject = workspace.project;
  }

  try {
    if ((await docker.prerequisite()) !== 'ready') {
      throw new Error('Docker with Compose v2 must be installed and running.');
    }
    await assertInstalledApplicationStopped();
    // Declining the fresh start is an intentional exit, as cancelling the installed command is.
    if (options.fresh && (await freshStart(storage)) === 'cancelled') {
      return true;
    }
    console.log(`Dev workspace: ${storage.directory} (Docker project ${workspace.project})`);
    const installation = (await storage.read()) ?? (await installForDevelopment(storage, docker));
    const { release } = installation;
    await new ModelDownloader().ensure(installation.modelDirectory, (action) =>
      console.log(action),
    );
    const secrets = await storage.secrets();
    const bridgePort = resolveLocalBridgePort();
    const webPort = resolveLocalWebPort();

    await new LocalLifecycleOwners(storage).exclusive(async () => {
      assertObservedRelease(await docker.inspect(), release);

      const devPath = storage.devComposePath;
      const devCompose = devComposeConfiguration(
        installation,
        secrets,
        bridgePort,
        webPort,
        join(root, 'apps', 'api', 'db', 'flyway'),
      );
      await storage.writeCompose(devCompose, devPath);

      // Checked on every launch, so a first download that was interrupted resumes on the next run.
      const pinnedImages = Object.fromEntries(
        Object.entries(devCompose.services).map(([service, { image }]) => [service, image]),
      );
      await docker.pullMissing(
        devPath,
        pinnedImages,
        (missing) => console.log(`Downloading the pinned images for ${missing.join(', ')}`),
        printImageProgress(),
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
        ['dev:no-watch'],
        localApiEnvironment(secrets, DEV_INFRASTRUCTURE_ENDPOINTS, webPort),
        logDirectory,
      ),
      startFromSource(
        'ui',
        join(root, 'apps', 'ui'),
        ['exec', 'vite', '--port', String(webPort), '--strictPort'],
        devWebEnvironment(bridgePort, webPort),
        logDirectory,
      ),
    );

    console.log('Waiting for the API (graph/search starts once it serves signing keys)');
    await docker.health(['postgres', 'redis']);
    await docker.startGraphSearch(storage.devComposePath);
    await docker.health(INFRASTRUCTURE);
    assertObservedRelease(await docker.inspect(), release);

    const navigation = {
      url: `${localWebOrigin(webPort)}/local`,
      reconnectCommand: 'pnpm dev:run local dev',
      stopCommand: 'Ctrl+C',
    };
    console.log(`Local Hey Hey (dev mode): ${navigation.url}`);
    return await continueLocalApplication(
      storage,
      release,
      navigation,
      bridgePort,
      webPort,
      () => {},
      { project: workspace.project, services: INFRASTRUCTURE },
      new LocalCliState(
        storage.directory,
        new LocalKeyPairStore(undefined, workspace.credentialService),
      ),
      diagnostics,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'heyhey local dev failed.');
    console.error(`Dev-mode logs: ${join(storage.directory, 'dev-logs')}`);
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
