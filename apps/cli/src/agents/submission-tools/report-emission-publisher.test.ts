import { describe, expect, it, vi } from 'vitest';
import type { ServerLogger } from '../../server/logger';
import { NOOP_LOGGER } from '../../server/logger';
import { createTestRunRegistryWiring } from '../../server/__tests__/helpers/test-run-registry';
import { MonitorPipeline } from '../../server/monitors';
import { AgentSource } from '../../server/monitors/normalizer/agent-source';
import { createTestMonitorRunnerDependencies } from '../../server/monitors/test-owners.test-support';
import { DEFAULT_TRIGGER_CONFIG } from '../../server/monitors/trigger-config';
import { ReportEmissionEvents } from './report-emission-events';
import { ReportEmissionPublisher } from './report-emission-publisher';

const makeLogger = (): ServerLogger =>
  ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }) as unknown as ServerLogger;

describe('ReportEmissionEvents', () => {
  it('publishes to current subscribers and stops after unsubscribe', () => {
    const events = new ReportEmissionEvents();
    const listener = vi.fn();
    const emission = {
      runId: 'run-1',
      reportId: 'report-1',
    };

    events.subscribe(listener);
    events.publish(emission);
    events.unsubscribe(listener);
    events.publish(emission);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(emission);
  });
});

describe('ReportEmissionPublisher', () => {
  it('normalizes and publishes a successful report emission through the named owners', () => {
    const canonical = { eventType: 'report_emission', origin: 'self' } as never;
    const { runRegistry } = createTestRunRegistryWiring();
    const agentSource = new AgentSource(runRegistry);
    const ingest = vi.spyOn(agentSource, 'ingest').mockReturnValue(canonical);
    const monitorPipeline = new MonitorPipeline({
      ...createTestMonitorRunnerDependencies(),
      monitors: [],
      triggerConfig: DEFAULT_TRIGGER_CONFIG,
      logger: NOOP_LOGGER,
    });
    const publish = vi.spyOn(monitorPipeline, 'ingest').mockImplementation(() => undefined);
    const logger = makeLogger();
    const publisher = new ReportEmissionPublisher(agentSource, monitorPipeline, logger);
    const events = new ReportEmissionEvents();
    events.subscribe(publisher.handle);

    events.publish({
      runId: 'run-1',
      reportId: 'report-1',
      reportType: 'IMPLEMENT',
    });

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'report_emission',
        runId: 'run-1',
        reportId: 'report-1',
        reportType: 'IMPLEMENT',
        targetSessionId: 'run-1',
      }),
    );
    expect(publish).toHaveBeenCalledWith(canonical);
    expect(logger.info).toHaveBeenCalledWith('monitors.agent_source.report_emission', {
      runId: 'run-1',
      reportId: 'report-1',
      targetSessionId: 'run-1',
    });
  });

  it('logs and stops when the Run has no conversation to normalize against', () => {
    const { runRegistry } = createTestRunRegistryWiring();
    const agentSource = new AgentSource(runRegistry);
    vi.spyOn(agentSource, 'ingest').mockReturnValue(undefined);
    const monitorPipeline = new MonitorPipeline({
      ...createTestMonitorRunnerDependencies(),
      monitors: [],
      triggerConfig: DEFAULT_TRIGGER_CONFIG,
      logger: NOOP_LOGGER,
    });
    const publish = vi.spyOn(monitorPipeline, 'ingest').mockImplementation(() => undefined);
    const logger = makeLogger();
    const publisher = new ReportEmissionPublisher(agentSource, monitorPipeline, logger);
    const events = new ReportEmissionEvents();
    events.subscribe(publisher.handle);

    events.publish({
      runId: 'run-missing',
      reportId: 'report-2',
    });

    expect(publish).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'monitors.agent_source.report_emission.no_conversation',
      { runId: 'run-missing', reportId: 'report-2' },
    );
  });
});
