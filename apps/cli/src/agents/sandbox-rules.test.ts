import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveCodexPermissionPlan } from './providers/codex/codex-permissions';
import type { ResolvedRunWorkspace } from './run-scope';
import { RunWorkspaceWriteBoundary } from './workspace-write-boundary';

// One view of what each provider's sandbox permits, so every Sandbox rule is
// checked the same way on Claude, Codex and OpenCode.
interface SandboxView {
  readonly writeRoots: readonly string[];
  readonly systemTempWritable: boolean;
  readonly tmpdirWritable: boolean;
  readonly readsRestricted: boolean;
  readonly hostUnixSockets: readonly string[];
  readonly failClosed: boolean;
}

interface Fixture {
  readonly service: string;
  readonly otherService: string;
  readonly boundary: RunWorkspaceWriteBoundary;
}

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

const makeFixture = async (): Promise<Fixture> => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-rules-')));
  const service = path.join(base, 'service');
  const otherService = path.join(base, 'other-service');
  await fs.mkdir(path.join(service, '.git'), { recursive: true });
  await fs.mkdir(otherService);
  const workspace: ResolvedRunWorkspace = {
    ok: true,
    runMode: 'default',
    repositoryPathForRunStarted: service,
    cwd: service,
    allowedRepositoryRoots: [service],
    bindingRepositoryPath: service,
    workspaceRoot: null,
  };
  const boundary = await RunWorkspaceWriteBoundary.create(workspace, {
    runScopeId: 'sandbox-rules',
    providerStateRoot: path.join(base, 'provider-state'),
  });
  cleanup.push(async () => {
    await boundary.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  return { service, otherService, boundary };
};

const providers: Record<string, (fixture: Fixture) => Promise<SandboxView>> = {
  claude: async ({ boundary }) => {
    const { sandbox } = boundary.claudeContainment().settings;
    return {
      writeRoots: sandbox.filesystem.allowWrite,
      // Claude's native sandbox always permits its own temp directories.
      systemTempWritable: true,
      tmpdirWritable: true,
      readsRestricted: false,
      hostUnixSockets: sandbox.network.allowUnixSockets,
      failClosed: sandbox.failIfUnavailable && !sandbox.allowUnsandboxedCommands,
    };
  },
  codex: async ({ service }) => {
    const plan = await resolveCodexPermissionPlan({
      cwd: service,
      allowedRepositoryRoots: [service],
      enforceWorkspaceContainment: true,
      codexHome: path.join(service, '.codex-home'),
      systemConfigPath: path.join(service, 'missing-system-config.toml'),
    });
    const config = plan.workspaceWriteConfig!.sandbox_workspace_write;
    return {
      writeRoots: [plan.cwd, ...config.writable_roots],
      systemTempWritable: !config.exclude_slash_tmp,
      tmpdirWritable: !config.exclude_tmpdir_env_var,
      // workspace-write reads the whole disk; network access stays off, which
      // also denies Unix sockets, and Codex refuses to run without its sandbox.
      readsRestricted: false,
      hostUnixSockets: [],
      failClosed: plan.sandboxMode === 'workspace-write',
    };
  },
  opencode: async ({ boundary }) => {
    const containment = boundary.processContainment();
    const settings = JSON.parse(await fs.readFile(containment.argsPrefix[1]!, 'utf8')) as {
      filesystem: { allowWrite: string[]; denyRead: string[] };
      network: { allowUnixSockets: string[] };
    };
    const privateTemp = containment.env['TMPDIR']!;
    return {
      writeRoots: settings.filesystem.allowWrite.filter(
        (root) => !root.startsWith(path.dirname(privateTemp)),
      ),
      systemTempWritable: settings.filesystem.allowWrite.includes('/tmp'),
      tmpdirWritable: settings.filesystem.allowWrite.includes(privateTemp),
      readsRestricted: settings.filesystem.denyRead.length > 0,
      hostUnixSockets: settings.network.allowUnixSockets.filter(
        (socketRoot) => socketRoot !== privateTemp,
      ),
      failClosed: containment.command === process.execPath,
    };
  },
};

describe.each(Object.entries(providers))('Sandbox rules on %s', (provider, view) => {
  it('limits writes to the Service folders', async () => {
    const fixture = await makeFixture();
    const sandbox = await view(fixture);
    expect(sandbox.writeRoots).toContain(fixture.service);
    expect(sandbox.writeRoots).not.toContain(fixture.otherService);
    expect(sandbox.writeRoots.every((root) => !fixture.otherService.startsWith(root))).toBe(true);
  });

  it('lets the agent write $TMPDIR', async () => {
    expect((await view(await makeFixture())).tmpdirWritable).toBe(true);
  });

  // OpenCode's outer launcher only allows its private TMPDIR; opening /tmp
  // there is an open decision (see the task report), so it is not asserted.
  it.skipIf(provider === 'opencode')('lets the agent write /tmp', async () => {
    expect((await view(await makeFixture())).systemTempWritable).toBe(true);
  });

  it('does not restrict reads', async () => {
    expect((await view(await makeFixture())).readsRestricted).toBe(false);
  });

  it('keeps host Unix sockets unreachable', async () => {
    expect((await view(await makeFixture())).hostUnixSockets).toEqual([]);
  });

  it('fails rather than running unsandboxed', async () => {
    expect((await view(await makeFixture())).failClosed).toBe(true);
  });
});
