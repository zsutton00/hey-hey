import { describe, expect, it, vi } from 'vitest';
import {
  createDirectoryPicker,
  createSaveFilePicker,
  DirectoryPickerUnavailableError,
} from './directory-picker';

describe('createDirectoryPicker', () => {
  it('returns the macOS-selected POSIX directory', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: '/Users/example/service/\n',
      stderr: '',
    });
    const picker = createDirectoryPicker({ platform: 'darwin', runCommand });

    await expect(picker()).resolves.toEqual({
      status: 'selected',
      repositoryPath: '/Users/example/service/',
    });
    expect(runCommand).toHaveBeenCalledWith('osascript', expect.any(Array));
  });

  it('treats macOS user cancellation as an explicit non-error result', async () => {
    const picker = createDirectoryPicker({
      platform: 'darwin',
      runCommand: vi.fn().mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'execution error: User canceled. (-128)',
      }),
    });

    await expect(picker()).resolves.toEqual({ status: 'cancelled' });
  });

  it('recognizes localized macOS cancellation by its AppleScript error number', async () => {
    const picker = createDirectoryPicker({
      platform: 'darwin',
      runCommand: vi.fn().mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'execution error: El usuario ha cancelado. (-128)',
      }),
    });

    await expect(picker()).resolves.toEqual({ status: 'cancelled' });
  });

  it('uses a native folder picker on Windows', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: 'C:\\service\r\n',
      stderr: '',
    });
    const picker = createDirectoryPicker({ platform: 'win32', runCommand });

    await expect(picker()).resolves.toEqual({
      status: 'selected',
      repositoryPath: 'C:\\service',
    });
    expect(runCommand).toHaveBeenCalledWith('powershell', expect.arrayContaining(['-Command']));
  });

  it('uses zenity and preserves Linux cancellation', async () => {
    const runCommand = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: '' });
    const picker = createDirectoryPicker({ platform: 'linux', runCommand });

    await expect(picker()).resolves.toEqual({ status: 'cancelled' });
    expect(runCommand).toHaveBeenCalledWith('zenity', [
      '--file-selection',
      '--directory',
      '--title=Choose a Service directory',
    ]);
  });

  it('preserves trailing whitespace in a Linux directory name', async () => {
    const picker = createDirectoryPicker({
      platform: 'linux',
      runCommand: vi.fn().mockResolvedValue({
        code: 0,
        stdout: '/workspace/service \n',
        stderr: '',
      }),
    });

    await expect(picker()).resolves.toEqual({
      status: 'selected',
      repositoryPath: '/workspace/service ',
    });
  });

  it('reports unsupported platforms as unavailable', async () => {
    const picker = createDirectoryPicker({ platform: 'aix' });

    await expect(picker()).rejects.toBeInstanceOf(DirectoryPickerUnavailableError);
  });
});

describe('createSaveFilePicker', () => {
  it('passes the suggested name to the macOS save dialog and returns the chosen path', async () => {
    const runCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: '/Users/example/Desktop/debug.jsonl\n',
      stderr: '',
    });
    const picker = createSaveFilePicker({ platform: 'darwin', runCommand });

    await expect(picker('debug-x.jsonl')).resolves.toEqual({
      status: 'selected',
      path: '/Users/example/Desktop/debug.jsonl',
    });
    expect(runCommand).toHaveBeenCalledWith('osascript', expect.arrayContaining(['debug-x.jsonl']));
  });

  it('treats macOS cancellation as cancelled, not failure', async () => {
    const picker = createSaveFilePicker({
      platform: 'darwin',
      runCommand: vi.fn().mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'execution error: User canceled. (-128)',
      }),
    });
    await expect(picker('debug.jsonl')).resolves.toEqual({ status: 'cancelled' });
  });

  it('passes the suggested name to Windows through the environment', async () => {
    const runCommand = vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    const picker = createSaveFilePicker({ platform: 'win32', runCommand });
    await expect(picker('debug.jsonl')).resolves.toEqual({ status: 'cancelled' });
    expect(runCommand).toHaveBeenCalledWith('powershell', expect.any(Array), {
      HEYHEY_SUGGESTED_FILENAME: 'debug.jsonl',
    });
  });

  it('uses zenity in save mode on Linux and surfaces failures', async () => {
    const runCommand = vi.fn().mockResolvedValue({ code: 5, stdout: '', stderr: 'no display' });
    const picker = createSaveFilePicker({ platform: 'linux', runCommand });
    await expect(picker('debug.jsonl')).rejects.toThrow('no display');
    expect(runCommand.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(['--save', '--filename=debug.jsonl']),
    );
  });

  it('rejects on unsupported platforms', async () => {
    await expect(createSaveFilePicker({ platform: 'aix' })('debug.jsonl')).rejects.toBeInstanceOf(
      DirectoryPickerUnavailableError,
    );
  });
});
