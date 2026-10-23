import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '..');
const resolverScript = join(repositoryRoot, 'scripts', 'openapi-root.cjs');
const temporaryRoots: string[] = [];
const canonical = (filePath: string): string => realpathSync(filePath);

const runGit = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

const initRepository = (root: string, files: Record<string, string>): void => {
  mkdirSync(root, { recursive: true });
  runGit(root, ['init', '-q', '-b', 'main']);
  runGit(root, ['config', 'user.email', 'tests@example.com']);
  runGit(root, ['config', 'user.name', 'OpenAPI resolver tests']);
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-q', '-m', 'initial']);
};

const openapiSpec = (marker: string): string =>
  [
    'openapi: 3.0.0',
    'info:',
    '  title: OpenAPI resolver fixture',
    '  version: 1.0.0',
    'paths: {}',
    `x-source-marker: ${marker}`,
    '',
  ].join('\n');

const markerGenerator = [
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const [outputPath] = process.argv.slice(2);',
  "fs.writeFileSync(outputPath, fs.readFileSync(path.join(__dirname, '../specs/api/openapi.yaml')));",
  '',
].join('\n');

interface Fixture {
  root: string;
  cliRoot: string;
  cliWorktree: string;
  nestedDirectory: string;
  openapiRoot: string;
  matchingOpenapiRoot: string;
  overrideRoot: string;
}

const createFixture = (withMatchingOpenapi: boolean): Fixture => {
  const root = mkdtempSync(join(tmpdir(), 'cli-openapi-root-'));
  temporaryRoots.push(root);
  const cliRoot = join(root, 'cli');
  const openapiRoot = join(root, 'openapi');
  const cliWorktree = join(cliRoot, '.worktrees', 'workspace-a');
  const matchingOpenapiRoot = join(openapiRoot, '.worktrees', 'workspace-a');
  const nestedDirectory = join(cliWorktree, 'src', 'nested');
  const overrideRoot = join(root, 'openapi-pinned');

  initRepository(cliRoot, { 'README.md': 'cli fixture\n' });
  initRepository(openapiRoot, {
    'scripts/generate-marker.cjs': markerGenerator,
    'specs/api/openapi.yaml': openapiSpec('main-checkout'),
  });

  mkdirSync(dirname(cliWorktree), { recursive: true });
  runGit(cliRoot, ['worktree', 'add', '-q', '-b', 'workspace-a', cliWorktree]);
  mkdirSync(nestedDirectory, { recursive: true });

  if (withMatchingOpenapi) {
    mkdirSync(dirname(matchingOpenapiRoot), { recursive: true });
    runGit(openapiRoot, ['worktree', 'add', '-q', '-b', 'workspace-a', matchingOpenapiRoot]);
    writeFileSync(
      join(matchingOpenapiRoot, 'specs/api/openapi.yaml'),
      openapiSpec('matching-worktree'),
    );
  }

  mkdirSync(join(overrideRoot, 'specs/api'), { recursive: true });
  writeFileSync(join(overrideRoot, 'specs/api/openapi.yaml'), openapiSpec('explicit-override'));

  return {
    root,
    cliRoot,
    cliWorktree,
    nestedDirectory,
    openapiRoot,
    matchingOpenapiRoot,
    overrideRoot,
  };
};

const environmentFor = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  delete environment['HEY_HEY_OPENAPI_ROOT'];
  delete environment['HEY_HEY_WORKSPACE_ID'];
  return { ...environment, ...overrides };
};

const runResolver = (
  cwd: string,
  environment: NodeJS.ProcessEnv = environmentFor(),
  args: string[] = [],
): { stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [resolverScript, ...args], {
    cwd,
    encoding: 'utf8',
    env: environment,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Resolver exited with ${result.status}`);
  }
  return { stdout: result.stdout.trim(), stderr: result.stderr };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('OpenAPI worktree resolver', () => {
  it('selects the same-named OpenAPI worktree from the linked CLI repository root', () => {
    const fixture = createFixture(true);

    const result = runResolver(fixture.cliWorktree);

    expect(result.stdout).toBe(canonical(fixture.matchingOpenapiRoot));
    expect(result.stderr).toContain(
      `[openapi] source=${canonical(fixture.matchingOpenapiRoot)} selection=matching_worktree workspace=workspace-a`,
    );
  });

  it('uses Git metadata when invoked from a nested directory', () => {
    const fixture = createFixture(true);

    const result = runResolver(fixture.nestedDirectory);

    expect(result.stdout).toBe(canonical(fixture.matchingOpenapiRoot));
  });

  it('keeps an explicit OpenAPI root authoritative', () => {
    const fixture = createFixture(true);

    const result = runResolver(
      fixture.nestedDirectory,
      environmentFor({ HEY_HEY_OPENAPI_ROOT: fixture.overrideRoot }),
    );

    expect(result.stdout).toBe(canonical(fixture.overrideRoot));
    const context = JSON.parse(
      runResolver(
        fixture.cliWorktree,
        environmentFor({ HEY_HEY_OPENAPI_ROOT: fixture.overrideRoot }),
        ['--context'],
      ).stdout,
    ) as { openapiSource: string; openapiRoot: string };
    expect(context).toMatchObject({
      openapiSource: 'explicit_override',
      openapiRoot: canonical(fixture.overrideRoot),
    });
  });

  it('falls back to the main OpenAPI checkout when no matching worktree exists', () => {
    const fixture = createFixture(false);

    const result = runResolver(fixture.cliWorktree);

    expect(result.stdout).toBe(canonical(fixture.openapiRoot));
    expect(result.stderr).toContain('selection=main_checkout');
  });

  it('reports main-checkout identity and source through the diagnostic command', () => {
    const fixture = createFixture(false);

    const context = JSON.parse(
      runResolver(fixture.cliRoot, environmentFor(), ['--context']).stdout,
    ) as {
      isLinkedWorktree: boolean;
      openapiRoot: string;
      openapiSource: string;
      repositoryRoot: string;
      workspaceId: string | null;
    };

    expect(context).toMatchObject({
      isLinkedWorktree: false,
      openapiRoot: canonical(fixture.openapiRoot),
      openapiSource: 'main_checkout',
      repositoryRoot: canonical(fixture.cliRoot),
      workspaceId: null,
    });
  });

  it('generates from a deliberately divergent matching OpenAPI worktree', () => {
    const fixture = createFixture(true);
    const selectedOpenapiRoot = runResolver(fixture.cliWorktree).stdout;
    const outputPath = join(fixture.root, 'generated.txt');

    execFileSync(
      process.execPath,
      [join(selectedOpenapiRoot, 'scripts/generate-marker.cjs'), outputPath],
      { cwd: fixture.cliWorktree, encoding: 'utf8' },
    );

    const generated = readFileSync(outputPath, 'utf8');
    expect(generated).toContain('matching-worktree');
    expect(generated).not.toContain('main-checkout');
  });
});
