import { CustomLoggerService } from '../logger.service';
import { ErrorFileWriter } from '../error-file-writer.service';
import { TemporalWinstonLogger } from '../../../workflows/temporal-winston-logger';

describe('serialized logger attribute collisions', () => {
  const previousLevel = process.env.LOG_LEVEL;
  let write: jest.SpyInstance;
  let logger: CustomLoggerService;

  beforeEach(() => {
    process.env.LOG_LEVEL = 'debug';
    const stdout = (console as unknown as { _stdout: NodeJS.WriteStream })
      ._stdout;
    write = jest.spyOn(stdout, 'write').mockImplementation(() => true);
    logger = new CustomLoggerService();
    write.mockClear();
  });

  afterEach(() => {
    write.mockRestore();
    if (previousLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previousLevel;
  });

  function record(): Record<string, unknown> {
    return JSON.parse(String(write.mock.calls.at(-1)?.[0])) as Record<
      string,
      unknown
    >;
  }

  const attributes = {
    message: 'caller message',
    level: 'caller level',
    timestamp: 'caller time',
    source: 'caller source',
    service: 'caller service',
    traceId: 'caller trace',
    event: 'caller event',
    operation: 'caller operation',
    context: 'caller context',
    path: { segment: 'unexpected object' },
    statusCode: 'unexpected string',
    error: 'approval rejected',
    caller_error: 'already prefixed',
    caller_caller_error: 'also already prefixed',
    caller_prompt: 'excluded prompt',
    caller_caller_payload: { text: 'excluded payload' },
    caller_headers: { authorization: 'excluded header' },
    password: 'excluded secret',
  };

  it.each(['nest', 'direct', 'context', 'temporal'])(
    'preserves values through %s stdout serialization',
    (shape) => {
      if (shape === 'nest')
        logger.error('Approval failed', attributes, 'ApprovalService');
      if (shape === 'direct')
        logger.error(
          'Approval failed',
          undefined,
          'ApprovalService',
          attributes,
        );
      if (shape === 'context')
        logger.logWithContext('error', 'Approval failed', {
          ...attributes,
          path: '/valid',
          statusCode: 503,
        });
      if (shape === 'temporal')
        new TemporalWinstonLogger().error('Approval failed', attributes);
      const output = record();
      expect(output.message).toBe('Approval failed');
      expect(output.level).toBe('error');
      for (const field of [
        'message',
        'level',
        'timestamp',
        'source',
        'service',
        'traceId',
        'event',
        'operation',
        'path',
        'statusCode',
      ]) {
        expect(output[`caller_${field}`]).toEqual(
          shape === 'context' && field === 'path'
            ? '/valid'
            : shape === 'context' && field === 'statusCode'
              ? 503
              : attributes[field as keyof typeof attributes],
        );
      }
      expect(Object.values(output)).toEqual(
        expect.arrayContaining([
          'caller context',
          'approval rejected',
          'already prefixed',
          'also already prefixed',
        ]),
      );
      expect(JSON.stringify(output)).not.toMatch(/excluded/);
    },
  );

  it('preserves metadata errors alongside an Error argument and sanitized stacks', () => {
    const error = new TypeError('private error message');
    error.stack =
      'TypeError: private error message\n    at handler (test.js:1:1)';
    logger.error(
      error,
      {
        error: 'metadata reason',
        stack: 'Error: caller\n    at caller (test.js:2:2)',
        errorStack: 'Error: other\n    at other (test.js:3:3)',
      },
      'Service',
    );
    expect(record()).toMatchObject({
      errorName: 'TypeError',
      caller_error: 'metadata reason',
      caller_stack: 'at caller (test.js:2:2)',
      caller_errorStack: 'at other (test.js:3:3)',
    });
    expect(JSON.stringify(record())).not.toContain('private error message');
  });

  it('retains metadata Error details with the existing opt-in gate', () => {
    const error = new Error('metadata failure password=hunter2');
    logger.logError(new Error('primary'), { error, includeErrorDetails: true });
    expect(record().caller_error).toMatchObject({
      errorMessage: 'metadata failure password=[REDACTED]',
    });
    expect(JSON.stringify(record())).not.toContain('hunter2');
  });

  it('preserves ordinary log metadata without allowing it to change severity', () => {
    logger.log(
      'Service started',
      { message: 'metadata', level: 'error', context: 'metadata context' },
      'Service',
    );
    expect(record()).toMatchObject({
      message: 'Service started',
      level: 'info',
      component: 'Service',
      caller_message: 'metadata',
      caller_level: 'error',
    });
    expect(Object.values(record())).toContain('metadata context');
  });

  it('preserves metadata Error identity and stack while keeping its message gated', () => {
    const error = new TypeError('gated detail');
    error.stack = 'TypeError: gated detail\n    at metadata (test.js:4:4)';
    logger.error('Failed', { error });
    expect(record().caller_error).toEqual({
      errorName: 'TypeError',
      errorStack: 'at metadata (test.js:4:4)',
    });
    expect(JSON.stringify(record())).not.toContain('gated detail');
  });

  it('returns immediately while the separate diagnostic writer remains pending', () => {
    const writer = new ErrorFileWriter();
    const pendingWrite = jest
      .spyOn(writer, 'writeErrorFile')
      .mockImplementation(() => new Promise(() => {}));
    const active = new CustomLoggerService(writer);
    expect(active.error('failure', { error: 'reason' })).toBeUndefined();
    expect(pendingWrite).toHaveBeenCalledTimes(1);
  });
});
