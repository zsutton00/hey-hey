import { EventContextManager } from '../../core/events/observable-event.context';
import { TemporalWinstonLogger } from '../temporal-winston-logger';

describe('TemporalWinstonLogger', () => {
  it('opts activity failures into detailed production diagnostics', () => {
    const logger = new TemporalWinstonLogger();
    const log = jest
      .spyOn((logger as any).winstonLogger, 'log')
      .mockImplementation(() => (logger as any).winstonLogger);
    const error = new Error('outside canonical plan');
    logger.warn('Activity failed', { error });
    expect(log).toHaveBeenCalledWith(
      'warn',
      'Activity failed',
      expect.objectContaining({ error, includeErrorDetails: true }),
    );
    log.mockRestore();
  });

  it('uses only the non-blocking console transport', () => {
    const logger = new TemporalWinstonLogger();
    const transports = (logger as any).winstonLogger.transports as Array<{
      filename?: string;
      constructor: { name: string };
    }>;

    expect(transports).toHaveLength(1);
    expect(transports[0]!.constructor.name).toBe('Console');
    expect(transports[0]!.filename).toBeUndefined();
  });

  it('merges asynchronous event context into the envelope input', async () => {
    const manager = EventContextManager.getInstance();
    const context = manager.createInitialContext('test', 'activity', {
      requestId: 'request-1',
      correlationId: 'correlation-1',
      organizationId: 'org-1' as never,
      projectId: 'project-1' as never,
      agentSessionId: 'session-1',
    });
    const logger = new TemporalWinstonLogger();
    const log = jest
      .spyOn((logger as any).winstonLogger, 'log')
      .mockImplementation(() => (logger as any).winstonLogger);

    await manager.runWithContext(context, async () => {
      logger.info('activity completed');
    });

    expect(log).toHaveBeenCalledWith(
      'info',
      'activity completed',
      expect.objectContaining({ source: 'temporal' }),
    );
  });
});
