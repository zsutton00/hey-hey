import { describe, expect, it, vi } from 'vitest';
import {
  DiagnosticFeed,
  writeDirectOutput,
  type CapturedConsoleRecord,
} from '../server/diagnostic-feed';
import { installTerminalCapture, type TerminalCaptureTarget } from './terminal-capture';

const fakeTarget = () => {
  const stdoutWrite = vi.fn(() => true);
  const stderrWrite = vi.fn(() => true);
  const consoleMethods = {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const target = {
    console: { ...consoleMethods },
    stdout: { write: stdoutWrite, columns: 120, isTTY: true } as unknown as NodeJS.WriteStream,
    stderr: { write: stderrWrite } as unknown as NodeJS.WriteStream,
  } satisfies TerminalCaptureTarget;
  return { target, stdoutWrite, stderrWrite, consoleMethods };
};

describe('installTerminalCapture', () => {
  it('routes console calls and stray writes to the capture sink instead of the terminal', () => {
    const { target, stdoutWrite, stderrWrite, consoleMethods } = fakeTarget();
    const records: CapturedConsoleRecord[] = [];
    const capture = installTerminalCapture({ capture: (record) => records.push(record) }, target);

    target.console.log('hello %s', 'world');
    target.console.error(new Error('bad'));
    target.stderr.write('stray stderr\n');
    const done = vi.fn();
    target.stdout.write('stray stdout\n', done);

    expect(
      records.map((record) => [record.stream, record.source, record.text.split('\n')[0]]),
    ).toEqual([
      ['stdout', 'log', 'hello world'],
      ['stderr', 'error', 'Error: bad'],
      ['stderr', 'write', 'stray stderr'],
      ['stdout', 'write', 'stray stdout'],
    ]);
    expect(consoleMethods.log).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
    capture.restore();
  });

  it('lets the renderer write to the real stdout and read its size', () => {
    const { target, stdoutWrite } = fakeTarget();
    const capture = installTerminalCapture({ capture: vi.fn() }, target);
    capture.rendererStdout.write('frame');
    expect(stdoutWrite).toHaveBeenCalledWith('frame');
    expect(capture.rendererStdout.columns).toBe(120);
    capture.restore();
  });

  it('does not recurse when the sink itself writes, and skips deliberate output', () => {
    const { target } = fakeTarget();
    const feed = new DiagnosticFeed();
    const capture = installTerminalCapture(
      {
        capture: (record) => {
          // A sink that logs would re-enter the hook.
          target.console.warn('sink saw', record.text);
          feed.capture(record);
        },
      },
      target,
    );
    target.console.log('once');
    writeDirectOutput(() => target.stdout.write('structured log line\n'));
    expect(feed.snapshot().records.map((record) => record.text)).toEqual(['once']);
    capture.restore();
  });

  it('restores the console and streams exactly', () => {
    const { target, stdoutWrite, stderrWrite, consoleMethods } = fakeTarget();
    const capture = installTerminalCapture({ capture: vi.fn() }, target);
    capture.restore();
    capture.restore();
    expect(target.console.log).toBe(consoleMethods.log);
    expect(Reflect.get(target.stdout, 'write')).toBe(stdoutWrite);
    expect(Reflect.get(target.stderr, 'write')).toBe(stderrWrite);
  });
});
