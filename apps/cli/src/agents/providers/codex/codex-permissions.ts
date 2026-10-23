import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface ResolveCodexSandboxModeArgs {
  cwd: string;
  allowedRepositoryRoots?: readonly string[];
  readOnlyFilesystem?: boolean;
  enforceWorkspaceContainment?: boolean;
  codexHome?: string;
  systemConfigPath?: string;
}

export interface CodexPermissionPlan {
  sandboxMode?: CodexSandboxMode;
  cwd: string;
  allowedRepositoryRoots: string[];
  extraWritableDirs: string[];
  workspaceWriteConfig?: {
    sandbox_workspace_write: {
      exclude_slash_tmp: boolean;
      exclude_tmpdir_env_var: boolean;
      writable_roots: string[];
    };
  };
}

const PERMISSION_KEYS = new Set(['sandbox_mode', 'default_permissions']);

const stripTomlComment = (line: string): string => {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        quote = null;
      }
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') {
      return line.slice(0, index);
    }
  }
  return line;
};

export const codexConfigDeclaresPermissionDefault = (text: string): boolean => {
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith('[')) {
      return false;
    }
    const match = /^([A-Za-z0-9_-]+)\s*=/u.exec(line);
    if (match?.[1] && PERMISSION_KEYS.has(match[1])) {
      return true;
    }
  }
  return false;
};

const fileDeclaresPermissionDefault = async (filePath: string): Promise<boolean> => {
  try {
    return codexConfigDeclaresPermissionDefault(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return false;
    }
    return false;
  }
};

const resolveCodexHome = (override: string | undefined): string => {
  if (override) return override;
  if (process.env['CODEX_HOME']) return process.env['CODEX_HOME'];
  return path.join(os.homedir(), '.codex');
};

const findProjectConfigPaths = async (cwd: string): Promise<string[]> => {
  const configs: string[] = [];
  let current = path.resolve(cwd);
  for (;;) {
    configs.push(path.join(current, '.codex', 'config.toml'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return configs.reverse();
};

const hasCodexPermissionConfig = async (args: ResolveCodexSandboxModeArgs): Promise<boolean> => {
  const codexHome = resolveCodexHome(args.codexHome);
  const configPaths = [
    args.systemConfigPath ?? '/etc/codex/config.toml',
    path.join(codexHome, 'config.toml'),
    ...(await findProjectConfigPaths(args.cwd)),
  ];
  for (const configPath of configPaths) {
    if (await fileDeclaresPermissionDefault(configPath)) {
      return true;
    }
  }
  return false;
};

const isVersionControlled = async (cwd: string): Promise<boolean> => {
  let current = path.resolve(cwd);
  for (;;) {
    try {
      await fs.lstat(path.join(current, '.git'));
      return true;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        )
      ) {
        return false;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
};

const toCanonicalPath = async (inputPath: string, cwd: string): Promise<string> => {
  const resolvedPath = path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(cwd, inputPath);
  const missingSegments: string[] = [];
  let existingPath = resolvedPath;
  for (;;) {
    try {
      return path.join(await fs.realpath(existingPath), ...missingSegments.reverse());
    } catch {
      const parentPath = path.dirname(existingPath);
      if (parentPath === existingPath) {
        return resolvedPath;
      }
      missingSegments.push(path.basename(existingPath));
      existingPath = parentPath;
    }
  }
};

const isWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const dedupePreservingOrder = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
};

const resolveCanonicalWorkspace = async (
  cwd: string,
  allowedRepositoryRoots: readonly string[],
): Promise<{ cwd: string; allowedRepositoryRoots: string[]; extraWritableDirs: string[] }> => {
  const canonicalCwd = await toCanonicalPath(cwd, cwd);
  const canonicalRoots = dedupePreservingOrder(
    await Promise.all(
      allowedRepositoryRoots.map((rootPath) => toCanonicalPath(rootPath, cwd)),
    ),
  );
  if (!canonicalRoots.some((rootPath) => isWithinRoot(canonicalCwd, rootPath))) {
    throw new Error(`Codex cwd ${canonicalCwd} is outside the Run-authorized workspace roots.`);
  }

  return {
    cwd: canonicalCwd,
    allowedRepositoryRoots: canonicalRoots,
    extraWritableDirs: canonicalRoots.filter(
      (rootPath) => !isWithinRoot(rootPath, canonicalCwd),
    ),
  };
};

export const resolveCodexSandboxMode = async (
  args: ResolveCodexSandboxModeArgs,
): Promise<CodexSandboxMode | undefined> => {
  if (args.readOnlyFilesystem) {
    return 'read-only';
  }
  if (args.enforceWorkspaceContainment) {
    return 'workspace-write';
  }
  if (!(await isVersionControlled(args.cwd))) {
    return undefined;
  }
  if (await hasCodexPermissionConfig(args)) {
    return undefined;
  }
  return 'workspace-write';
};

export const resolveCodexPermissionPlan = async (
  args: ResolveCodexSandboxModeArgs,
): Promise<CodexPermissionPlan> => {
  const sandboxMode = await resolveCodexSandboxMode(args);
  const requestedRoots =
    args.allowedRepositoryRoots ?? (args.enforceWorkspaceContainment ? [] : [args.cwd]);
  if (args.enforceWorkspaceContainment && requestedRoots.length === 0) {
    throw new Error('A repository-bound Codex Run requires at least one authorized workspace root.');
  }
  const workspace = await resolveCanonicalWorkspace(args.cwd, requestedRoots);
  if (sandboxMode !== 'workspace-write') {
    return {
      ...(sandboxMode ? { sandboxMode } : {}),
      ...workspace,
      extraWritableDirs: [],
    };
  }

  return {
    sandboxMode,
    ...workspace,
    ...(args.enforceWorkspaceContainment
      ? {
          workspaceWriteConfig: {
            sandbox_workspace_write: {
              exclude_slash_tmp: false,
              exclude_tmpdir_env_var: false,
              writable_roots: workspace.extraWritableDirs,
            },
          },
        }
      : {}),
  };
};
