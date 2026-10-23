import { writeDirectOutput } from './diagnostic-feed';

export type ServerLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_ORDER: Record<ServerLogLevel, number> = {
  trace: 5,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface ServerLogEntry {
  timestamp: string;
  level: ServerLogLevel;
  event: string;
  [key: string]: unknown;
}

export interface ServerLogger {
  trace(event: string, fields?: Record<string, unknown>): void;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): ServerLogger;
}

export interface ServerLogSink {
  append(entry: ServerLogEntry): void;
}

/** One sink that tees each entry to several; a failing sink never starves the others. */
export const fanOutLogSinks = (...sinks: readonly ServerLogSink[]): ServerLogSink => ({
  append: (entry) => {
    for (const sink of sinks) {
      try {
        sink.append(entry);
      } catch {
        // A sink failure must never interrupt logging or its sibling sinks.
      }
    }
  },
});

export interface ServerLoggerOptions {
  minLevel?: ServerLogLevel;
  now?: () => Date;
  writeLine?: (line: string) => void;
  /**
   * Optional sink that receives every emitted entry before it is written
   * out. Used to tee entries into the in-process ring buffer so the debug
   * endpoint can dump a per-run trail on demand.
   */
  sink?: ServerLogSink;
}

const ANSI_RESET = '\u001B[0m';
const ANSI_LEVEL_COLOR: Record<ServerLogLevel, string> = {
  trace: '\u001B[90m',
  debug: '\u001B[2m',
  info: '\u001B[36m',
  warn: '\u001B[33m',
  error: '\u001B[31m',
};

const shouldUseAnsiColors = (): boolean => {
  const noColor = process.env['NO_COLOR'];
  if (typeof noColor === 'string') {
    return false;
  }

  const forceColor = process.env['FORCE_COLOR'];
  if (forceColor === '0') {
    return false;
  }
  if (forceColor !== undefined) {
    return true;
  }

  return Boolean(process.stdout.isTTY) && process.env['TERM'] !== 'dumb';
};

const colorizeLine = (line: string, level: ServerLogLevel): string =>
  `${ANSI_LEVEL_COLOR[level]}${line}${ANSI_RESET}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeValue = (value: unknown): unknown => {
  if (value instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };

    if (value.stack) {
      serialized['stack'] = value.stack;
    }

    if ('cause' in value && value.cause !== undefined) {
      serialized['cause'] = normalizeValue(value.cause);
    }

    return serialized;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeValue(entry);
    }
    return normalized;
  }

  return value;
};

const normalizeRecord = (value: Record<string, unknown>): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    normalized[key] = normalizeValue(entry);
  }
  return normalized;
};

const VALID_LOG_LEVELS: ReadonlySet<string> = new Set(['trace', 'debug', 'info', 'warn', 'error']);

const resolveLogLevelFromEnv = (): ServerLogLevel | undefined => {
  const raw = process.env['LOG_LEVEL'];
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  return isServerLogLevel(normalized) ? normalized : undefined;
};

const isServerLogLevel = (value: string): value is ServerLogLevel => VALID_LOG_LEVELS.has(value);

class StructuredLogRuntime {
  public readonly minLevel: ServerLogLevel;
  public readonly now: () => Date;
  public readonly writeLine: (line: string, level: ServerLogLevel) => void;
  public readonly sink: ServerLogSink | undefined;

  public constructor(options: ServerLoggerOptions) {
    this.minLevel = options.minLevel ?? resolveLogLevelFromEnv() ?? 'info';
    this.now = options.now ?? (() => new Date());
    this.sink = options.sink;
    const useAnsiColors = shouldUseAnsiColors();
    this.writeLine = options.writeLine
      ? (line) => writeDirectOutput(() => options.writeLine?.(line))
      : (line, level) => {
          const formattedLine = useAnsiColors ? colorizeLine(line, level) : line;
          writeDirectOutput(() => process.stdout.write(`${formattedLine}\n`));
        };
  }
}

/** Concrete structured logger. `ServerLogger` remains the genuine logging port. */
export class StructuredServerLogger implements ServerLogger {
  private readonly runtime: StructuredLogRuntime;
  private readonly bindings: Record<string, unknown>;

  public constructor(
    options: ServerLoggerOptions = {},
    bindings: Record<string, unknown> = {},
    runtime?: StructuredLogRuntime,
  ) {
    if (runtime) {
      this.runtime = runtime;
      this.bindings = bindings;
      return;
    }

    this.runtime = new StructuredLogRuntime(options);
    this.bindings = bindings;
  }

  public trace(event: string, fields?: Record<string, unknown>): void {
    this.emit('trace', event, fields);
  }

  public debug(event: string, fields?: Record<string, unknown>): void {
    this.emit('debug', event, fields);
  }

  public info(event: string, fields?: Record<string, unknown>): void {
    this.emit('info', event, fields);
  }

  public warn(event: string, fields?: Record<string, unknown>): void {
    this.emit('warn', event, fields);
  }

  public error(event: string, fields?: Record<string, unknown>): void {
    this.emit('error', event, fields);
  }

  public child(bindings: Record<string, unknown>): ServerLogger {
    return new StructuredServerLogger(
      {},
      {
        ...this.bindings,
        ...bindings,
      },
      this.runtime,
    );
  }

  private emit(level: ServerLogLevel, event: string, fields?: Record<string, unknown>): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.runtime.minLevel]) return;

    const entry: ServerLogEntry = {
      timestamp: this.runtime.now().toISOString(),
      level,
      event,
      ...normalizeRecord(this.bindings),
      ...(fields ? normalizeRecord(fields) : {}),
    };

    if (this.runtime.sink) {
      try {
        this.runtime.sink.append(entry);
      } catch {
        // A sink failure must never interrupt logging.
      }
    }

    this.runtime.writeLine(JSON.stringify(entry), level);
  }
}

class NoopServerLogger implements ServerLogger {
  public trace(): void {}
  public debug(): void {}
  public info(): void {}
  public warn(): void {}
  public error(): void {}
  public child(): ServerLogger {
    return this;
  }
}

export const NOOP_LOGGER: ServerLogger = new NoopServerLogger();
