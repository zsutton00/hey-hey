import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const cliRoot = path.resolve(__dirname, '../..');
const repositoryRoot = path.resolve(cliRoot, '../..');

describe('CLI source boundary', () => {
  it('loads shared and agent source without UI bundles, React providers or browser auth', async () => {
    const result = await build({
      absWorkingDir: repositoryRoot,
      entryPoints: [
        'apps/cli/src/agent-runtime/index.ts',
        'packages/ui-common/src/clients/shared.ts',
        'packages/ui-common/src/components/AgentSession/capabilityCatalog.ts',
      ],
      outdir: 'unused-boundary-output',
      platform: 'node',
      format: 'esm',
      bundle: true,
      packages: 'external',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some((file) => file.includes('agent-runtime/node/ClaudeCodeSdkClient.ts'))).toBe(
      true,
    );
    expect(inputs.some((file) => file.endsWith('clients/runtimeRegistry.ts'))).toBe(true);
    expect(
      inputs.filter((file) =>
        /ui-common\/dist|WebClientProvider|contexts\/|services\/(authService|configService|runtimeConfig)|entityIcons/.test(
          file,
        ),
      ),
    ).toEqual([]);
    const imports = Object.values(result.metafile!.outputs).flatMap((output) =>
      output.imports.map((entry) => entry.path),
    );
    expect(
      imports.filter((specifier) =>
        /^(react|@mui|jotai|@hey-hey\/ui-common)(\/|$)/.test(specifier),
      ),
    ).toEqual([]);
  });

  it('has no local package dependency or UI Common build prerequisite', async () => {
    const manifest = JSON.parse(await readFile(path.join(cliRoot, 'package.json'), 'utf8'));
    for (const section of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      expect(Object.keys(manifest[section] ?? {})).not.toContain('@hey-hey/ui-common');
      expect(
        Object.values(manifest[section] ?? {}).filter((version) =>
          /^(file:|link:|workspace:)/.test(String(version)),
        ),
      ).toEqual([]);
    }
    expect(manifest.scripts.build).toBe('node scripts/build.mjs');
    expect(manifest.scripts.typecheck).toBe('pnpm tsc --noEmit');
  });
});
