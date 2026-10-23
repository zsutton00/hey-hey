/**
 * TerminalCapture — keeps the screen the renderer's alone while the menu is
 * mounted.
 *
 * `console.*` calls and stray writes to stdout/stderr (libraries, provider
 * runners, child process pipes) become typed records in the diagnostic
 * capture sink instead of reaching the terminal. The renderer receives a
 * stdout view that still writes directly. Deliberate process output written
 * through `writeDirectOutput` is never recorded twice. A hook re-entered while
 * it is recording drops the nested write rather than recursing.
 *
 * `restore()` puts back exactly what it replaced, so teardown leaves the
 * terminal and console as they were before the menu mounted.
 */

import { format } from 'node:util';
import {
  isDirectOutputActive,
  type CapturedConsoleRecord,
  type CapturedConsoleStream,
  type DiagnosticCaptureSink,
} from '../server/diagnostic-feed';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

const CONSOLE_STREAM: Record<ConsoleMethod, CapturedConsoleStream> = {
  log: 'stdout',
  info: 'stdout',
  debug: 'stdout',
  warn: 'stderr',
  error: 'stderr',
};

type WriteFunction = NodeJS.WriteStream['write'];

export interface TerminalCaptureTarget {
  readonly console: Pick<Console, ConsoleMethod>;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: NodeJS.WriteStream;
}

export interface TerminalCapture {
  /** The process stdout with its original `write`, for the renderer only. */
  readonly rendererStdout: NodeJS.WriteStream;
  restore(): void;
}

const chunkText = (chunk: unknown, encoding: unknown): string => {
  if (typeof chunk === 'string') return chunk;
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString(
      typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8',
    );
  }
  return String(chunk);
};

/** Text without the trailing newline every console call and most writes end with. */
const trimNewline = (text: string): string => text.replace(/\r?\n$/u, '');

export const installTerminalCapture = (
  sink: DiagnosticCaptureSink,
  target: TerminalCaptureTarget = { console, stdout: process.stdout, stderr: process.stderr },
  now: () => Date = () => new Date(),
): TerminalCapture => {
  let recording = false;
  const record = (captured: Omit<CapturedConsoleRecord, 'timestamp'>): void => {
    if (recording || isDirectOutputActive()) return;
    recording = true;
    try {
      sink.capture({ ...captured, timestamp: now().toISOString() });
    } catch {
      // The sink never throws by contract; a capture hook must not either.
    } finally {
      recording = false;
    }
  };

  const originalConsole = new Map<ConsoleMethod, Console[ConsoleMethod]>();
  const methods = Object.keys(CONSOLE_STREAM) as ConsoleMethod[];
  for (const method of methods) {
    originalConsole.set(method, target.console[method]);
    target.console[method] = (...args: unknown[]): void => {
      record({ stream: CONSOLE_STREAM[method], source: method, text: format(...args) });
    };
  }

  const replaceWrite = (stream: NodeJS.WriteStream, name: CapturedConsoleStream): WriteFunction => {
    // Restored onto the same stream object, so its receiver stays correct.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = stream.write;
    const captured = function (
      this: unknown,
      chunk: unknown,
      encoding?: unknown,
      callback?: unknown,
    ) {
      record({ stream: name, source: 'write', text: trimNewline(chunkText(chunk, encoding)) });
      const done = typeof encoding === 'function' ? encoding : callback;
      if (typeof done === 'function') process.nextTick(done);
      return true;
    } as WriteFunction;
    stream.write = captured;
    return original;
  };
  const originalStdoutWrite = replaceWrite(target.stdout, 'stdout');
  const originalStderrWrite = replaceWrite(target.stderr, 'stderr');

  // A view of stdout whose `write` bypasses capture. Every other member —
  // size, TTY state, resize events — is the real stream's.
  const rendererStdout = new Proxy(target.stdout, {
    get: (stream, property) => {
      if (property === 'write') return originalStdoutWrite.bind(stream);
      const value: unknown = Reflect.get(stream, property, stream);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(stream)
        : value;
    },
  });

  let restored = false;
  return {
    rendererStdout,
    restore: () => {
      if (restored) return;
      restored = true;
      for (const method of methods) {
        const original = originalConsole.get(method);
        if (original) target.console[method] = original;
      }
      target.stdout.write = originalStdoutWrite;
      target.stderr.write = originalStderrWrite;
    },
  };
};
