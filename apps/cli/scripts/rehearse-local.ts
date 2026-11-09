/** Prepare a no-publish package. Requires skopeo and a disposable Docker engine. */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { parseManifestForVersion, RELEASE_PLATFORMS } from '../src/release/release-manifest';

// macOS AirPlay Receiver owns 5000 by default, so publish the registry on an uncommon loopback port.
const REGISTRY_PORT = 5055;

async function main(): Promise<void> {
  const [sourcesPath, outputPath, registryImage] = process.argv.slice(2);
  if (
    !sourcesPath ||
    !outputPath ||
    !registryImage ||
    !/^\S+@sha256:[a-f0-9]{64}$/.test(registryImage)
  ) {
    throw new Error(
      'Usage: tsx scripts/rehearse-local.ts sources.json NEW_DIRECTORY registry:2@sha256:<real digest>',
    );
  }
  const cliRoot = resolve(dirname(resolve(process.argv[1]!)), '..');
  const output = resolve(outputPath);
  mkdirSync(output, { mode: 0o700 });
  const source = z.string().regex(/^(oci:|docker:\/\/).+/);
  const sources = z
    .strictObject({ api: source, ui: source, graphSearch: source, postgres: source, redis: source })
    .parse(JSON.parse(readFileSync(resolve(sourcesPath), 'utf8')));
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd: cliRoot, stdio: 'inherit' });
  // Typecheck and build the real package, then pack its built output in isolation.
  // The unit-test suite is not part of packaging evidence and runs in the normal gate.
  for (const script of ['typecheck', 'build']) {
    run('pnpm', [script]);
  }
  const registryName = `heyhey-rehearsal-${process.pid}`;
  run('docker', [
    'run',
    '-d',
    '--name',
    registryName,
    '-p',
    `127.0.0.1:${REGISTRY_PORT}:5000`,
    registryImage,
  ]);
  writeFileSync(join(output, 'registry.txt'), `${registryName}\n`, { mode: 0o600 });
  console.log(
    `REHEARSAL registry retained: ${registryName}. Stop it manually when you are done testing.`,
  );
  // The registry process can be created before its HTTP listener is ready.
  let registryReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${REGISTRY_PORT}/v2/`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        registryReady = true;
        break;
      }
    } catch {
      // Wait only for this newly created rehearsal registry.
    }
    await setTimeout(500);
  }
  if (!registryReady) {
    throw new Error(
      `Rehearsal registry ${registryName} did not become ready on loopback port ${REGISTRY_PORT}.`,
    );
  }
  const images: Record<string, { reference: string; platforms: string[] }> = {};
  for (const [name, from] of Object.entries(sources)) {
    const destination = `localhost:${REGISTRY_PORT}/heyhey/${name.toLowerCase()}:rehearsal`;
    run('skopeo', ['copy', '--all', '--dest-tls-verify=false', from, `docker://${destination}`]);
    const raw = execFileSync('skopeo', [
      'inspect',
      '--raw',
      '--tls-verify=false',
      `docker://${destination}`,
    ]);
    const index = z
      .object({
        manifests: z.array(
          z.object({ platform: z.object({ os: z.string(), architecture: z.string() }).optional() }),
        ),
      })
      .parse(JSON.parse(raw.toString()));
    const available = index.manifests.flatMap((item) =>
      item.platform ? [`${item.platform.os}/${item.platform.architecture}`] : [],
    );
    if (!RELEASE_PLATFORMS.every((platform) => available.includes(platform))) {
      throw new Error(
        `${name} must contain real linux/amd64 and linux/arm64 manifests; do not label a single-platform image as multiarch.`,
      );
    }
    const digest = createHash('sha256').update(raw).digest('hex');
    images[name] = {
      reference: `${destination.split(':rehearsal')[0]}@sha256:${digest}`,
      platforms: [...RELEASE_PLATFORMS],
    };
  }
  const packageJson = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
  const manifest = parseManifestForVersion(
    JSON.stringify({ schemaVersion: 1, cliVersion: packageJson.version, images }),
    packageJson.version,
  );
  const stage = join(output, 'package');
  mkdirSync(stage);
  cpSync(join(cliRoot, 'dist'), join(stage, 'dist'), { recursive: true });
  writeFileSync(join(stage, 'package.json'), JSON.stringify(packageJson, null, 2));
  writeFileSync(join(stage, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
  // No generated manifest is written into the checkout. Checks above replace the
  // prepack lifecycle in this staging directory, which has no source/dependencies.
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', output], {
    cwd: stage,
    stdio: 'inherit',
  });
  console.log(
    `REHEARSAL ONLY: install the tarball with npm install -g --prefix <new-directory> <tarball>, then run <new-directory>/bin/heyhey local.`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Rehearsal preparation failed.');
  process.exitCode = 1;
});
