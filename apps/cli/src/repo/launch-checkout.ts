import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ServerLogger } from '../server/logger';

const execFileAsync = promisify(execFile);

const readCheckout = async (
  directory: string,
): Promise<{ root: string; commonDirectory: string } | null> => {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
      { cwd: directory, timeout: 5000 },
    );
    const [root, commonDirectory] = stdout.trim().split('\n');
    return root && commonDirectory
      ? { root: path.resolve(root), commonDirectory: path.resolve(commonDirectory) }
      : null;
  } catch {
    // Marker-free service directories and a CLI launched outside Git remain supported.
    return null;
  }
};

/** A non-worktree run must not inherit another checkout of the CLI's current repository. */
export const findLaunchCheckoutConflict = async (
  repositoryPath: string,
  worktreeEnabled: boolean,
  logger?: ServerLogger,
  cliDirectory = process.cwd(),
): Promise<string | null> => {
  if (worktreeEnabled || path.resolve(repositoryPath) === path.resolve(cliDirectory)) return null;
  const [cli, selected] = await Promise.all([
    readCheckout(cliDirectory),
    readCheckout(repositoryPath),
  ]);
  if (
    !cli ||
    !selected ||
    cli.commonDirectory !== selected.commonDirectory ||
    cli.root === selected.root
  ) {
    logger?.debug('local.launch_checkout.checked', {
      cliDirectory,
      repositoryPath,
      conflict: false,
    });
    return null;
  }
  const message = `Non-worktree launch refused: the CLI is running from ${cli.root}, but the selected repository mapping points to another checkout of the same repository: ${selected.root}. Correct the Service repository mapping and start a new session; existing sessions retain their saved workspace.`;
  logger?.error('local.launch_checkout.conflict', {
    cliDirectory: cli.root,
    repositoryPath: selected.root,
    commonDirectory: cli.commonDirectory,
  });
  return message;
};
