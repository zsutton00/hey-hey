import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { debuglog } from 'node:util';
import type { ResolvedRunWorkspace } from './run-scope';

/**
 * Claude is contained by its own native sandbox (configured here from the Run
 * roots) plus the runner's write-target checks — never by the CLI's outer
 * launcher — so it keeps its sessions in the user's real Claude config dir.
 */
export interface ClaudeWorkspaceContainment {
  readonly additionalDirectories: readonly string[];
  readonly settings: {
    readonly sandbox: ClaudeSandboxConfiguration;
  };
  readonly settingSources: readonly string[];
}

type ClaudeSandboxFilesystem = {
  readonly allowWrite: readonly string[];
  readonly allowRead: readonly string[];
};

type ClaudeSandboxConfiguration = {
  readonly enabled: true;
  readonly failIfUnavailable: true;
  readonly allowUnsandboxedCommands: false;
  readonly excludedCommands: readonly string[];
  readonly filesystem: ClaudeSandboxFilesystem;
  readonly network: { readonly allowUnixSockets: readonly string[] };
};

// Fail-closed on every platform: the turn fails if the sandbox cannot start,
// Bash never runs unsandboxed, and no host Unix socket (Docker, ssh-agent) is
// reachable. Write-capable sessions may reach remote hosts over ssh/scp/rsync
// (e.g. running migrations on the Linux box).
const REMOTE_SHELL_COMMANDS = ['ssh', 'scp', 'rsync'] as const;

// Sessions load the same settings a plain `claude` launch would. The --settings
// sandbox wins over these scopes, so the write roots above still bound writes.
const CLAUDE_SETTING_SOURCES = ['user', 'project', 'local'] as const;

const claudeSandboxConfiguration = (
  filesystem: ClaudeSandboxFilesystem,
  excludedCommands: readonly string[] = [],
): ClaudeSandboxConfiguration => ({
  enabled: true,
  failIfUnavailable: true,
  allowUnsandboxedCommands: false,
  excludedCommands,
  filesystem,
  network: { allowUnixSockets: [] },
});

export interface ProviderProcessContainment {
  readonly command: string;
  readonly argsPrefix: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface RunWorkspaceWriteBoundaryOptions {
  /** Stable identity used to preserve provider session state across Run re-materialization. */
  readonly runScopeId: string;
  /** Test seam for the durable provider-state parent directory. */
  readonly providerStateRoot?: string;
  /** Existing directories providers may read but must never write or track. */
  readonly readOnlyDirectories?: readonly string[];
}

export class WorkspaceWriteOutsideRunError extends Error {
  public constructor(
    public readonly requestedPath: string,
    public readonly canonicalPath: string,
    public readonly allowedRepositoryRoots: readonly string[],
  ) {
    super(`Write target ${canonicalPath} is outside the Run workspace.`);
    this.name = 'WorkspaceWriteOutsideRunError';
  }
}

const isWithinRoot = (candidatePath: string, rootPath: string): boolean => {
  const relative = path.relative(rootPath, candidatePath);
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const dedupe = (paths: readonly string[]): string[] => Array.from(new Set(paths));

const debug = debuglog('heyhey:workspace-write-boundary');
const MAX_UNIX_SOCKET_PATH_BYTES = 103;
// Reserve a signed 32-bit PID and every base-36 digit of the largest safely
// incrementable JavaScript integer used by sandbox-runtime's socket counter.
const MAX_MUX_SOCKET_NAME = `srt-mux-2147483647-${Number.MAX_SAFE_INTEGER.toString(36)}.sock`;

const defaultProviderStateRoot = (): string => {
  if (process.platform === 'win32') {
    return path.join(
      process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'heyhey',
      'provider-state',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'heyhey', 'provider-state');
  }
  return path.join(os.homedir(), '.config', 'heyhey', 'provider-state');
};

const providerStateDirectoryName = (runScopeId: string): string =>
  createHash('sha256').update(runScopeId).digest('hex');

const seedIfPresent = async (source: string, destination: string): Promise<void> => {
  try {
    await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'EEXIST') {
      throw error;
    }
  }
};

const resolveSandboxRuntimeModuleUrl =(): string => {
  const requireFromHere = createRequire(__filename);
  return pathToFileURL(requireFromHere.resolve('@anthropic-ai/sandbox-runtime')).href;
};

const buildSandboxLauncherSource = (): string => `
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { SandboxManager } from ${JSON.stringify(resolveSandboxRuntimeModuleUrl())};

const [settingsPath, command, ...args] = process.argv.slice(2);
if (!settingsPath || !command) throw new Error('Sandbox launcher requires settings and a command.');
const config = JSON.parse(await readFile(settingsPath, 'utf8'));
await SandboxManager.initialize(config, async () => true);
const quote = (value) => "'" + value.replaceAll("'", "'\\"'\\"'") + "'";
const wrapped = await SandboxManager.wrapWithSandboxArgv(
  [command, ...args].map(quote).join(' '),
  undefined,
  undefined,
  undefined,
  process.cwd(),
);
const child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
  cwd: process.cwd(),
  env: { ...process.env, ...wrapped.env },
  stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
await SandboxManager.reset();
process.exit(exitCode);
`;

const canonicalizePotentialPath = async (
  inputPath: string,
  visitedLinks: ReadonlySet<string> = new Set(),
): Promise<string> => {
  try {
    return await fs.realpath(inputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    const stat = await fs.lstat(inputPath);
    if (stat.isSymbolicLink()) {
      if (visitedLinks.has(inputPath)) {
        throw new Error(`Symbolic-link cycle while resolving write target ${inputPath}.`);
      }
      const linkTarget = await fs.readlink(inputPath);
      const absoluteTarget = path.resolve(path.dirname(inputPath), linkTarget);
      return canonicalizePotentialPath(absoluteTarget, new Set([...visitedLinks, inputPath]));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const parent = path.dirname(inputPath);
  if (parent === inputPath) {
    return inputPath;
  }
  const canonicalParent = await canonicalizePotentialPath(parent, visitedLinks);
  return path.join(canonicalParent, path.basename(inputPath));
};

export class RunWorkspaceWriteBoundary {
  public readonly cwd: string;
  public readonly allowedRepositoryRoots: readonly string[];
  public readonly readOnlyDirectories: readonly string[];

  private constructor(
    cwd: string,
    allowedRepositoryRoots: readonly string[],
    readOnlyDirectories: readonly string[],
    private readonly resolvedWorkspaceCwd: string,
    private readonly resolvedWorkspaceRoots: readonly string[],
    private readonly runtimeDirectory: string,
    private readonly sandboxSettingsPath: string,
    private readonly readOnlySandboxSettingsPath: string,
    private readonly sandboxLauncherPath: string,
    private readonly providerRuntimeDirectory: string,
    private readonly providerTempDirectory: string,
    private readonly xdgDataDirectory: string,
  ) {
    this.cwd = cwd;
    this.allowedRepositoryRoots = allowedRepositoryRoots;
    this.readOnlyDirectories = readOnlyDirectories;
  }

  public static async create(
    workspace: ResolvedRunWorkspace,
    options?: RunWorkspaceWriteBoundaryOptions,
  ): Promise<RunWorkspaceWriteBoundary> {
    const resolvedWorkspaceCwd = path.resolve(workspace.cwd);
    const resolvedWorkspaceRoots = dedupe(
      workspace.allowedRepositoryRoots.map((root) => path.resolve(root)),
    );
    const canonicalRoots = dedupe(
      await Promise.all(resolvedWorkspaceRoots.map((root) => canonicalizePotentialPath(root))),
    );
    const canonicalCwd = await canonicalizePotentialPath(resolvedWorkspaceCwd);
    if (!canonicalRoots.some((root) => isWithinRoot(canonicalCwd, root))) {
      throw new Error(`Run workspace cwd ${canonicalCwd} is outside its allowed repository roots.`);
    }
    const requestedReadOnlyDirectories = dedupe(
      (options?.readOnlyDirectories ?? []).map((directory) => path.resolve(directory)),
    );
    const canonicalReadOnlyDirectories = dedupe(
      await Promise.all(requestedReadOnlyDirectories.map((directory) => fs.realpath(directory))),
    );
    for (const readOnlyDirectory of canonicalReadOnlyDirectories) {
      if (canonicalRoots.some((root) => isWithinRoot(readOnlyDirectory, root))) {
        throw new Error(
          `Read-only directory ${readOnlyDirectory} must be outside writable repository roots.`,
        );
      }
    }

    const runtimeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'hh-'));
    try {
      const providerTempDirectory = path.join(runtimeDirectory, 't');
      const socketPathBytes = Buffer.byteLength(
        path.join(providerTempDirectory, MAX_MUX_SOCKET_NAME),
      );
      debug(
        'Validating sandbox socket path: bytes=%d limit=%d',
        socketPathBytes,
        MAX_UNIX_SOCKET_PATH_BYTES,
      );
      if (process.platform !== 'win32' && socketPathBytes > MAX_UNIX_SOCKET_PATH_BYTES) {
        debug('Rejecting sandbox temporary directory: socket path exceeds limit');
        throw new Error(
          `Sandbox temporary directory ${providerTempDirectory} is too long: mux socket paths may require ${socketPathBytes} bytes (limit ${MAX_UNIX_SOCKET_PATH_BYTES}). Set TMPDIR to a shorter directory before starting the CLI.`,
        );
      }
      const sandboxSettingsPath = path.join(runtimeDirectory, 'srt-settings.json');
      const readOnlySandboxSettingsPath = path.join(
        runtimeDirectory,
        'srt-read-only-settings.json',
      );
      const sandboxLauncherPath = path.join(runtimeDirectory, 'sandbox-launcher.mjs');
      const providerRuntimeDirectory = path.join(runtimeDirectory, 'provider-state');
      const xdgDataDirectory = options
        ? path.join(
            options.providerStateRoot ?? defaultProviderStateRoot(),
            providerStateDirectoryName(options.runScopeId),
            'data',
          )
        : path.join(providerRuntimeDirectory, 'data');
      await fs.mkdir(path.join(xdgDataDirectory, 'opencode'), { recursive: true });
      await fs.mkdir(providerTempDirectory);
      await Promise.all(
        ['cache', 'state'].map((directory) =>
          fs.mkdir(path.join(providerRuntimeDirectory, directory), { recursive: true }),
        ),
      );
      const sourceXdgDataDirectory =
        process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share');
      await seedIfPresent(
        path.join(sourceXdgDataDirectory, 'opencode', 'auth.json'),
        path.join(xdgDataDirectory, 'opencode', 'auth.json'),
      );
      const sandboxSettings = {
        filesystem: {
          allowWrite: dedupe([
            ...canonicalRoots,
            providerRuntimeDirectory,
            providerTempDirectory,
            xdgDataDirectory,
          ]),
          denyWrite: [],
          denyRead: [],
          allowRead: canonicalReadOnlyDirectories,
        },
        network: {
          allowedDomains: [],
          deniedDomains: [],
          allowLocalBinding: true,
          allowUnixSockets: [providerTempDirectory],
        },
      };
      debug('Allowing sandbox Unix sockets only beneath %s', providerTempDirectory);
      await fs.writeFile(sandboxSettingsPath, JSON.stringify(sandboxSettings), 'utf8');
      await fs.writeFile(
        readOnlySandboxSettingsPath,
        JSON.stringify({
          ...sandboxSettings,
          filesystem: {
            ...sandboxSettings.filesystem,
            allowWrite: dedupe([providerRuntimeDirectory, providerTempDirectory, xdgDataDirectory]),
          },
        }),
        'utf8',
      );
      await fs.writeFile(sandboxLauncherPath, buildSandboxLauncherSource(), 'utf8');

      debug('Created sandbox runtime directory %s', runtimeDirectory);
      return new RunWorkspaceWriteBoundary(
        canonicalCwd,
        Object.freeze(canonicalRoots),
        Object.freeze(canonicalReadOnlyDirectories),
        resolvedWorkspaceCwd,
        Object.freeze(resolvedWorkspaceRoots),
        runtimeDirectory,
        sandboxSettingsPath,
        readOnlySandboxSettingsPath,
        sandboxLauncherPath,
        providerRuntimeDirectory,
        providerTempDirectory,
        xdgDataDirectory,
      );
    } catch (error) {
      await fs.rm(runtimeDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  public matchesWorkspace(
    workspace: ResolvedRunWorkspace,
    readOnlyDirectories: readonly string[] = [],
  ): boolean {
    const roots = dedupe(workspace.allowedRepositoryRoots.map((root) => path.resolve(root)));
    const readRoots = dedupe(readOnlyDirectories.map((root) => path.resolve(root)));
    return (
      path.resolve(workspace.cwd) === this.resolvedWorkspaceCwd &&
      roots.length === this.resolvedWorkspaceRoots.length &&
      roots.every((root, index) => root === this.resolvedWorkspaceRoots[index]) &&
      readRoots.length === this.readOnlyDirectories.length &&
      readRoots.every((root, index) => root === this.readOnlyDirectories[index])
    );
  }

  public async resolveWriteTarget(requestedPath: string): Promise<string> {
    const absoluteTarget = path.isAbsolute(requestedPath)
      ? path.normalize(requestedPath)
      : path.resolve(this.cwd, requestedPath);
    const canonicalTarget = await canonicalizePotentialPath(absoluteTarget);
    if (!this.allowedRepositoryRoots.some((root) => isWithinRoot(canonicalTarget, root))) {
      throw new WorkspaceWriteOutsideRunError(
        requestedPath,
        canonicalTarget,
        this.allowedRepositoryRoots,
      );
    }
    return canonicalTarget;
  }

  public async assertWriteTargets(requestedPaths: readonly string[]): Promise<readonly string[]> {
    return Promise.all(
      requestedPaths.map((requestedPath) => this.resolveWriteTarget(requestedPath)),
    );
  }

  public claudeContainment(): ClaudeWorkspaceContainment {
    return {
      additionalDirectories: [
        ...this.allowedRepositoryRoots.filter((root) => root !== this.cwd),
        ...this.readOnlyDirectories,
      ],
      settings: {
        sandbox: claudeSandboxConfiguration(
          {
            allowWrite: this.allowedRepositoryRoots,
            allowRead: this.readOnlyDirectories,
          },
          REMOTE_SHELL_COMMANDS,
        ),
      },
      settingSources: CLAUDE_SETTING_SOURCES,
    };
  }

  public claudeReadOnlyContainment(): ClaudeWorkspaceContainment {
    return {
      ...this.claudeContainment(),
      settings: {
        sandbox: claudeSandboxConfiguration({
          allowWrite: [],
          allowRead: this.readOnlyDirectories,
        }),
      },
    };
  }

  /** Outer sandbox-runtime launcher for OpenCode; Claude uses its native sandbox. */
  public processContainment(): ProviderProcessContainment {
    return {
      command: process.execPath,
      argsPrefix: [this.sandboxLauncherPath, this.sandboxSettingsPath],
      env: {
        XDG_DATA_HOME: this.xdgDataDirectory,
        XDG_CACHE_HOME: path.join(this.providerRuntimeDirectory, 'cache'),
        XDG_STATE_HOME: path.join(this.providerRuntimeDirectory, 'state'),
        TMPDIR: this.providerTempDirectory,
      },
    };
  }

  public readOnlyProcessContainment(): ProviderProcessContainment {
    return {
      ...this.processContainment(),
      argsPrefix: [this.sandboxLauncherPath, this.readOnlySandboxSettingsPath],
    };
  }

  public async dispose(): Promise<void> {
    await fs.rm(this.runtimeDirectory, { recursive: true, force: true });
  }
}
