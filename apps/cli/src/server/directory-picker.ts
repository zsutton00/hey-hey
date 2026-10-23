import { spawn } from 'node:child_process';

type DirectoryPickerResult =
  | { status: 'selected'; repositoryPath: string }
  | { status: 'cancelled' };

export type DirectoryPicker = () => Promise<DirectoryPickerResult>;

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

type RunCommand = (
  command: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>,
) => Promise<CommandResult>;

export class DirectoryPickerUnavailableError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DirectoryPickerUnavailableError';
  }
}

const runCommand: RunCommand = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new DirectoryPickerUnavailableError(
            `The native picker command "${command}" is unavailable.`,
            { cause: error },
          ),
        );
        return;
      }
      reject(error);
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });

const selectedPath = (stdout: string): string | null => {
  const pathWithoutLineEnding = stdout.replace(/\r?\n$/, '');
  return pathWithoutLineEnding.length > 0 ? pathWithoutLineEnding : null;
};

const failureMessage = (result: CommandResult, fallback: string): string =>
  result.stderr.trim() || fallback;

export interface DirectoryPickerOptions {
  platform?: NodeJS.Platform;
  runCommand?: RunCommand;
}

export const createDirectoryPicker = ({
  platform = process.platform,
  runCommand: execute = runCommand,
}: DirectoryPickerOptions = {}): DirectoryPicker => {
  if (platform === 'darwin') {
    return async () => {
      const result = await execute('osascript', [
        '-e',
        'set selectedFolder to choose folder with prompt "Choose a Service directory"',
        '-e',
        'POSIX path of selectedFolder',
      ]);
      const repositoryPath = selectedPath(result.stdout);
      if (repositoryPath) return { status: 'selected', repositoryPath };
      if (
        /\(-128\)\s*$/.test(result.stderr) ||
        result.stderr.toLowerCase().includes('user canceled')
      ) {
        return { status: 'cancelled' };
      }
      throw new Error(failureMessage(result, 'Directory picker failed on macOS.'));
    };
  }

  if (platform === 'win32') {
    return async () => {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
        '$dialog.Description = "Choose a Service directory";',
        '$dialog.UseDescriptionForTitle = $true;',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
        '  Write-Output $dialog.SelectedPath',
        '}',
      ].join(' ');
      const result = await execute('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ]);
      const repositoryPath = selectedPath(result.stdout);
      if (repositoryPath) return { status: 'selected', repositoryPath };
      if (result.code === 0) return { status: 'cancelled' };
      throw new Error(failureMessage(result, 'Directory picker failed on Windows.'));
    };
  }

  if (platform === 'linux') {
    return async () => {
      const result = await execute('zenity', [
        '--file-selection',
        '--directory',
        '--title=Choose a Service directory',
      ]);
      const repositoryPath = selectedPath(result.stdout);
      if (repositoryPath) return { status: 'selected', repositoryPath };
      if (result.code === 1) return { status: 'cancelled' };
      throw new Error(
        failureMessage(
          result,
          'Directory picker failed on Linux. Ensure zenity is installed and a desktop session is available.',
        ),
      );
    };
  }

  return () =>
    Promise.reject(
      new DirectoryPickerUnavailableError(
        `Directory picker is unsupported on platform "${platform}".`,
      ),
    );
};

export const pickServiceDirectory = createDirectoryPicker();

type SaveFilePickerResult = { status: 'selected'; path: string } | { status: 'cancelled' };

/** Asks the user where to save a file, suggesting `suggestedName`. */
export type SaveFilePicker = (suggestedName: string) => Promise<SaveFilePickerResult>;

export const createSaveFilePicker = ({
  platform = process.platform,
  runCommand: execute = runCommand,
}: DirectoryPickerOptions = {}): SaveFilePicker => {
  if (platform === 'darwin') {
    return async (suggestedName) => {
      const result = await execute('osascript', [
        '-e',
        'on run argv',
        '-e',
        'set chosenFile to choose file name with prompt "Save Debug export" default name (item 1 of argv)',
        '-e',
        'POSIX path of chosenFile',
        '-e',
        'end run',
        suggestedName,
      ]);
      const path = selectedPath(result.stdout);
      if (path) return { status: 'selected', path };
      if (
        /\(-128\)\s*$/.test(result.stderr) ||
        result.stderr.toLowerCase().includes('user canceled')
      ) {
        return { status: 'cancelled' };
      }
      throw new Error(failureMessage(result, 'Save dialog failed on macOS.'));
    };
  }

  if (platform === 'win32') {
    return async (suggestedName) => {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$dialog = New-Object System.Windows.Forms.SaveFileDialog;',
        '$dialog.Title = "Save Debug export";',
        '$dialog.FileName = $env:HEYHEY_SUGGESTED_FILENAME;',
        '$dialog.OverwritePrompt = $true;',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
        '  Write-Output $dialog.FileName',
        '}',
      ].join(' ');
      const result = await execute(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { HEYHEY_SUGGESTED_FILENAME: suggestedName },
      );
      const path = selectedPath(result.stdout);
      if (path) return { status: 'selected', path };
      if (result.code === 0) return { status: 'cancelled' };
      throw new Error(failureMessage(result, 'Save dialog failed on Windows.'));
    };
  }

  if (platform === 'linux') {
    return async (suggestedName) => {
      const result = await execute('zenity', [
        '--file-selection',
        '--save',
        '--confirm-overwrite',
        '--title=Save Debug export',
        `--filename=${suggestedName}`,
      ]);
      const path = selectedPath(result.stdout);
      if (path) return { status: 'selected', path };
      if (result.code === 1) return { status: 'cancelled' };
      throw new Error(
        failureMessage(
          result,
          'Save dialog failed on Linux. Ensure zenity is installed and a desktop session is available.',
        ),
      );
    };
  }

  return () =>
    Promise.reject(
      new DirectoryPickerUnavailableError(`Save dialog is unsupported on platform "${platform}".`),
    );
};
