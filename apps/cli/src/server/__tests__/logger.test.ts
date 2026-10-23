/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructuredServerLogger } from '../logger';

const ORIGINAL_ENV = { ...process.env };

const restoreEnv = (): void => {
  process.env = { ...ORIGINAL_ENV };
};

describe('server logger colors', () => {
  beforeEach(() => {
    restoreEnv();
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it('applies ANSI color for warn logs when color is enabled', () => {
    process.env['FORCE_COLOR'] = '1';
    delete process.env['NO_COLOR'];

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const logger = new StructuredServerLogger();
    logger.warn('local.test.warn', { flag: true });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('\u001B[33m');
    expect(writes[0]).toContain('"level":"warn"');
    expect(writes[0]).toContain('\u001B[0m');
  });

  it('disables ANSI color when NO_COLOR is set', () => {
    process.env['NO_COLOR'] = '1';
    delete process.env['FORCE_COLOR'];

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const logger = new StructuredServerLogger();
    logger.error('local.test.error', { code: 'E_TEST' });

    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toContain('\u001B[');
    expect(writes[0]).toContain('"level":"error"');
  });

  it('keeps custom writeLine output uncolored', () => {
    process.env['FORCE_COLOR'] = '1';

    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      writeLine: (line) => {
        lines.push(line);
      },
    });

    logger.info('local.test.info', { check: 'plain' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\u001B[');
    expect(lines[0]).toContain('"level":"info"');
  });

  it('filters trace logs when default minLevel is info', () => {
    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      writeLine: (line) => {
        lines.push(line);
      },
    });

    logger.trace('local.test.trace', { detail: 1 });

    expect(lines).toHaveLength(0);
  });

  it('emits trace logs when minLevel is set to trace', () => {
    process.env['FORCE_COLOR'] = '1';

    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      minLevel: 'trace',
      writeLine: (line) => {
        lines.push(line);
      },
    });

    logger.trace('local.test.trace', { detail: 1 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"level":"trace"');
  });

  it('applies ANSI color for trace logs when color is enabled', () => {
    process.env['FORCE_COLOR'] = '1';
    delete process.env['NO_COLOR'];

    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array): boolean => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);

    const logger = new StructuredServerLogger({ minLevel: 'trace' });
    logger.trace('local.test.trace', { step: 'enter' });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('\u001B[90m');
    expect(writes[0]).toContain('"level":"trace"');
    expect(writes[0]).toContain('\u001B[0m');
  });
});
