import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  codexConfigDeclaresPermissionDefault,
  resolveCodexPermissionPlan,
  resolveCodexSandboxMode,
} from './codex-permissions';

const tempDirs: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-codex-permissions-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('codex-permissions', () => {
  it('detects active top-level Codex permission defaults', () => {
    expect(
      codexConfigDeclaresPermissionDefault(`
        model = "gpt-5.5"
        sandbox_mode = "read-only"

        [sandbox_workspace_write]
        network_access = false
      `),
    ).toBe(true);
    expect(codexConfigDeclaresPermissionDefault('default_permissions = ":workspace"')).toBe(true);
  });

  it('ignores commented examples and nested permission tables', () => {
    expect(
      codexConfigDeclaresPermissionDefault(`
        # sandbox_mode = "read-only"
        model = "gpt-5.5"

        [sandbox_workspace_write]
        writable_roots = ["/tmp"]
      `),
    ).toBe(false);
  });

  it('uses workspace-write for git workspaces without configured Codex permission defaults', async () => {
    const cwd = await makeTempDir();
    const codexHome = await makeTempDir();
    await fs.mkdir(path.join(cwd, '.git'));

    await expect(
      resolveCodexSandboxMode({
        cwd,
        codexHome,
        systemConfigPath: path.join(cwd, 'missing-system-config.toml'),
      }),
    ).resolves.toBe('workspace-write');
  });

  it('adds selected run roots outside cwd as extra writable dirs', async () => {
    const workspace = await makeTempDir();
    const cwd = path.join(workspace, 'service-a');
    const selectedServiceRoot = path.join(workspace, 'service-b');
    const nestedRoot = path.join(cwd, 'src');
    const codexHome = await makeTempDir();
    await fs.mkdir(path.join(cwd, '.git'), { recursive: true });
    await fs.mkdir(selectedServiceRoot, { recursive: true });
    const canonicalCwd = await fs.realpath(cwd);
    const canonicalSelectedServiceRoot = await fs.realpath(selectedServiceRoot);
    const canonicalNestedRoot = path.join(canonicalCwd, 'src');

    await expect(
      resolveCodexPermissionPlan({
        cwd,
        codexHome,
        allowedRepositoryRoots: [cwd, selectedServiceRoot, nestedRoot, selectedServiceRoot],
        enforceWorkspaceContainment: true,
        systemConfigPath: path.join(workspace, 'missing-system-config.toml'),
      }),
    ).resolves.toEqual({
      sandboxMode: 'workspace-write',
      cwd: canonicalCwd,
      allowedRepositoryRoots: [
        canonicalCwd,
        canonicalSelectedServiceRoot,
        canonicalNestedRoot,
      ],
      extraWritableDirs: [canonicalSelectedServiceRoot],
      workspaceWriteConfig: {
        sandbox_workspace_write: {
          exclude_slash_tmp: false,
          exclude_tmpdir_env_var: false,
          writable_roots: [canonicalSelectedServiceRoot],
        },
      },
    });
  });

  it('does not infer sibling repositories that are not selected for the run', async () => {
    const workspace = await makeTempDir();
    const cwd = path.join(workspace, 'service-a');
    const unselectedSibling = path.join(workspace, 'service-c');
    const codexHome = await makeTempDir();
    await fs.mkdir(path.join(cwd, '.git'), { recursive: true });
    await fs.mkdir(unselectedSibling, { recursive: true });
    const canonicalCwd = await fs.realpath(cwd);

    await expect(
      resolveCodexPermissionPlan({
        cwd,
        codexHome,
        allowedRepositoryRoots: [cwd],
        enforceWorkspaceContainment: true,
        systemConfigPath: path.join(workspace, 'missing-system-config.toml'),
      }),
    ).resolves.toEqual({
      sandboxMode: 'workspace-write',
      cwd: canonicalCwd,
      allowedRepositoryRoots: [canonicalCwd],
      extraWritableDirs: [],
      workspaceWriteConfig: {
        sandbox_workspace_write: {
          exclude_slash_tmp: false,
          exclude_tmpdir_env_var: false,
          writable_roots: [],
        },
      },
    });
  });

  it('does not allow configured Codex permission defaults to widen the Run sandbox', async () => {
    const cwd = await makeTempDir();
    const codexHome = await makeTempDir();
    await fs.mkdir(path.join(cwd, '.git'));
    await fs.writeFile(path.join(codexHome, 'config.toml'), 'sandbox_mode = "danger-full-access"\n');

    await expect(
      resolveCodexSandboxMode({
        cwd,
        codexHome,
        enforceWorkspaceContainment: true,
        systemConfigPath: path.join(cwd, 'missing-system-config.toml'),
      }),
    ).resolves.toBe('workspace-write');
  });

  it('retains only selected roots when Codex config requests unrestricted access', async () => {
    const workspace = await makeTempDir();
    const cwd = path.join(workspace, 'service-a');
    const selectedServiceRoot = path.join(workspace, 'service-b');
    const codexHome = await makeTempDir();
    await fs.mkdir(path.join(cwd, '.git'), { recursive: true });
    await fs.mkdir(selectedServiceRoot, { recursive: true });
    await fs.writeFile(path.join(codexHome, 'config.toml'), 'sandbox_mode = "danger-full-access"\n');
    const canonicalCwd = await fs.realpath(cwd);
    const canonicalSelectedServiceRoot = await fs.realpath(selectedServiceRoot);

    await expect(
      resolveCodexPermissionPlan({
        cwd,
        codexHome,
        allowedRepositoryRoots: [cwd, selectedServiceRoot],
        enforceWorkspaceContainment: true,
        systemConfigPath: path.join(workspace, 'missing-system-config.toml'),
      }),
    ).resolves.toEqual({
      sandboxMode: 'workspace-write',
      cwd: canonicalCwd,
      allowedRepositoryRoots: [canonicalCwd, canonicalSelectedServiceRoot],
      extraWritableDirs: [canonicalSelectedServiceRoot],
      workspaceWriteConfig: {
        sandbox_workspace_write: {
          exclude_slash_tmp: false,
          exclude_tmpdir_env_var: false,
          writable_roots: [canonicalSelectedServiceRoot],
        },
      },
    });
  });

  it('forces read-only when the handler declares read-only filesystem posture', async () => {
    const cwd = await makeTempDir();
    const codexHome = await makeTempDir();

    await expect(
      resolveCodexSandboxMode({
        cwd,
        codexHome,
        readOnlyFilesystem: true,
        systemConfigPath: path.join(cwd, 'missing-system-config.toml'),
      }),
    ).resolves.toBe('read-only');
  });

  it('does not add extra writable dirs for read-only filesystem posture', async () => {
    const workspace = await makeTempDir();
    const cwd = path.join(workspace, 'service-a');
    const selectedServiceRoot = path.join(workspace, 'service-b');
    const codexHome = await makeTempDir();
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(selectedServiceRoot, { recursive: true });
    const canonicalCwd = await fs.realpath(cwd);
    const canonicalSelectedServiceRoot = await fs.realpath(selectedServiceRoot);

    await expect(
      resolveCodexPermissionPlan({
        cwd,
        codexHome,
        readOnlyFilesystem: true,
        allowedRepositoryRoots: [cwd, selectedServiceRoot],
        enforceWorkspaceContainment: true,
        systemConfigPath: path.join(workspace, 'missing-system-config.toml'),
      }),
    ).resolves.toEqual({
      sandboxMode: 'read-only',
      cwd: canonicalCwd,
      allowedRepositoryRoots: [canonicalCwd, canonicalSelectedServiceRoot],
      extraWritableDirs: [],
    });
  });

  it('rejects a write-capable cwd outside every Run-authorized root', async () => {
    const workspace = await makeTempDir();
    const cwd = path.join(workspace, 'launch');
    const allowedRoot = path.join(workspace, 'selected-service');
    await fs.mkdir(cwd);
    await fs.mkdir(allowedRoot);

    await expect(
      resolveCodexPermissionPlan({ cwd, allowedRepositoryRoots: [allowedRoot] }),
    ).rejects.toThrow('outside the Run-authorized workspace roots');
  });

  it('rejects a repository-bound run without an authoritative root set', async () => {
    const cwd = await makeTempDir();

    await expect(
      resolveCodexPermissionPlan({
        cwd,
        allowedRepositoryRoots: [],
        enforceWorkspaceContainment: true,
      }),
    ).rejects.toThrow('requires at least one authorized workspace root');
  });
});
