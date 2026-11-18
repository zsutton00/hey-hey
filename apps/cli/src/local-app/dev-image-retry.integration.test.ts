import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { DockerBoundary } from './docker-boundary';
import { DockerProcess } from './docker-process';
import { devComposeConfiguration } from './compose';
import { InstallationStore } from './installation-store';
import { RELEASE_PLATFORMS, type ReleaseManifest } from '../release/release-manifest';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const pinned = (digit: string) => ({
  reference: `example.test/heyhey@sha256:${digit.repeat(64)}`,
  platforms: [...RELEASE_PLATFORMS],
});
const release = {
  schemaVersion: 1,
  cliVersion: '1.2.3',
  images: {
    api: pinned('a'),
    ui: pinned('b'),
    graphSearch: pinned('c'),
    postgres: pinned('d'),
    redis: pinned('e'),
  },
} satisfies ReleaseManifest;

interface DockerState {
  present: string[];
  /** Images the next pull downloads before the network drops; null never drops. */
  dropAfter: number | null;
  pulls: string[][];
}

/** A Docker CLI whose image store persists between runs and whose pulls can be interrupted. */
async function interruptibleDocker(root: string, images: Record<string, string>) {
  const statePath = join(root, 'docker-state.json');
  const initial: DockerState = { present: [], dropAfter: 2, pulls: [] };
  await writeFile(statePath, JSON.stringify(initial));
  const binary = join(root, 'docker');
  await writeFile(
    binary,
    `#!${process.execPath}
const fs = require('node:fs');
const images = ${JSON.stringify(images)};
const s = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}));
let a = process.argv.slice(2);
if (a[0] === '--host') a = a.slice(2);
const save = () => fs.writeFileSync(${JSON.stringify(statePath)}, JSON.stringify(s));
if (a[0] === 'image' && a[1] === 'inspect') {
  if (s.present.includes(a.at(-1))) { process.stdout.write('sha256:present'); }
  else { process.stderr.write('Error response from daemon: No such image: ' + a.at(-1)); process.exitCode = 1; }
} else if (a[0] === 'compose' && a.includes('version')) {
  process.stderr.write('unknown flag: --progress'); process.exitCode = 1;
} else if (a[0] === 'compose' && a.includes('pull')) {
  const named = a.slice(a.indexOf('pull') + 1);
  const services = named.length > 0 ? named : Object.keys(images);
  s.pulls.push(services);
  for (const service of services) {
    if (s.dropAfter === 0) { s.dropAfter = null; save(); process.stderr.write('Error: net/http: TLS handshake timeout'); process.exit(1); }
    if (s.dropAfter !== null) s.dropAfter -= 1;
    if (!s.present.includes(images[service])) s.present.push(images[service]);
  }
  save();
}
`,
    { mode: 0o700 },
  );
  const docker = new DockerBoundary(
    { attempts: 1, intervalMs: 1 },
    new DockerProcess({
      PATH: `${root}${delimiter}${process.env['PATH']}`,
      HOME: root,
      DOCKER_HOST: 'unix:///fixture/docker.sock',
    }),
  );
  const state = async () => JSON.parse(await readFile(statePath, 'utf8')) as DockerState;
  return { docker, state };
}

it('resumes an interrupted first image download on the next dev launch of the same installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'heyhey-dev-images-'));
  directories.push(root);
  const storage = new InstallationStore(join(root, 'local-application'));
  const installation = await storage.prepare(release);
  const compose = devComposeConfiguration(
    installation,
    await storage.secrets(),
    3851,
    3850,
    join(root, 'flyway'),
  );
  await storage.writeCompose(compose, storage.devComposePath);
  const pinnedImages = Object.fromEntries(
    Object.entries(compose.services).map(([service, { image }]) => [service, image]),
  );
  const { docker, state } = await interruptibleDocker(root, pinnedImages);

  const launch = () => docker.pullMissing(storage.devComposePath, pinnedImages, () => {});

  // Cold start: the network drops after two of the four pinned images.
  await expect(launch()).rejects.toThrow();
  expect(await storage.read()).toBeDefined();

  // Retry with the installation the failed run left behind fetches only what is still missing.
  const fetched = await launch();
  const afterRetry = await state();
  expect(fetched).toHaveLength(Object.keys(pinnedImages).length - 2);
  expect(afterRetry.pulls.at(-1)).toEqual(fetched);
  expect(afterRetry.present.sort()).toEqual(Object.values(pinnedImages).sort());

  // A later launch with everything present downloads nothing.
  expect(await launch()).toEqual([]);
  expect((await state()).pulls).toHaveLength(2);
});
