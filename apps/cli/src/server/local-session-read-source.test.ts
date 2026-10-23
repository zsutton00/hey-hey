import { describe, expect, it, vi } from 'vitest';
import type { Run } from '../run/run';
import { RunRegistry } from '../run/run-registry';
import {
  createTestMonitorProjectContext,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from '../run/run.test-support';
import type { AgentSessionCurrentState } from '../shared/api/generated/api';
import { NOOP_LOGGER } from './logger';
import { LocalSessionReadSource, type LocalSessionUpdate } from './local-session-read-source';
import { RunLifecycleEvents } from './run-lifecycle-events';

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected value');
  return value;
};

interface FakeRun {
  runId: string;
  agentSessionId: string;
  conversationId: string;
  organizationId: string;
  projectId: string;
  provider: 'claude';
  providerSessionId: string | null;
  session: { provider_conversation_id: string | null };
  entity: null;
  effectiveState: {
    agentSessionId: string;
    currentState: AgentSessionCurrentState;
    observedAt: string;
  } | null;
  hasActiveWork: boolean;
  createdAt: string;
  activeSince: string | null;
  loadedEntityContext: null;
  entityContextLoadStatus: null;
}

const fakeRun = (runId: string): FakeRun => ({
  runId,
  agentSessionId: `agent-session-${runId}`,
  conversationId: `conversation-${runId}`,
  organizationId: 'org-1',
  projectId: 'project-1',
  provider: 'claude',
  providerSessionId: 'pending_abc',
  session: { provider_conversation_id: null },
  entity: null,
  effectiveState: null,
  hasActiveWork: false,
  createdAt: '2026-10-04T00:00:00.000Z',
  activeSince: '2026-10-07T00:00:00.000Z',
  loadedEntityContext: null,
  entityContextLoadStatus: null,
});

const setup = () => {
  const runs = new Map<string, FakeRun>();
  const events = new RunLifecycleEvents();
  const registry = {
    get: (runId: string) => (runs.get(runId) ?? null) as Run | null,
    list: () => [...runs.values()] as unknown as readonly Run[],
  };
  const register = (run: FakeRun) => {
    runs.set(run.runId, run);
    events.publishRunRegistered(run.runId);
  };
  const remove = (runId: string) => {
    runs.delete(runId);
    events.publishRunRemoved(runId);
  };
  const source = new LocalSessionReadSource({
    runRegistry: registry,
    runLifecycleEvents: events,
    logger: NOOP_LOGGER,
  });
  return { runs, events, register, remove, source };
};

describe('LocalSessionReadSource', () => {
  it('lists exactly the registered Runs, idle ones included, with canonical identities', () => {
    const { register, remove, source } = setup();
    register(fakeRun('a'));
    register({ ...fakeRun('b'), providerSessionId: 'provider-b' });
    remove('a');

    const snapshot = source.snapshot();
    expect(snapshot.revision).toBe(3);
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.sessions[0]).toMatchObject({
      runId: 'b',
      agentSessionId: 'agent-session-b',
      conversationId: 'conversation-b',
      providerSessionId: 'provider-b',
      hasActiveWork: false,
      effectiveState: null,
    });
    expect(Object.isFrozen(snapshot.sessions)).toBe(true);
  });

  it('does not list a Run loaded only to answer a read until it starts a Turn', () => {
    const { runs, events, register, source } = setup();
    const restored = { ...fakeRun('old'), activeSince: null };
    register(restored);
    events.publishRunUpdated('old');
    expect(source.snapshot().sessions).toHaveLength(0);

    runs.set('old', { ...restored, activeSince: '2026-10-07T00:00:05.000Z' });
    events.publishRunUpdated('old');
    expect(source.snapshot().sessions).toMatchObject([
      { runId: 'old', activeSince: '2026-10-07T00:00:05.000Z' },
    ]);
  });

  it('hides pending provider session placeholders', () => {
    const { register, source } = setup();
    register(fakeRun('a'));
    expect(source.snapshot().sessions[0]?.providerSessionId).toBeNull();
  });

  it('includes Runs registered before construction', () => {
    const runs = new Map([['a', fakeRun('a')]]);
    const source = new LocalSessionReadSource({
      runRegistry: {
        get: (runId) => (runs.get(runId) ?? null) as Run | null,
        list: () => [...runs.values()] as unknown as readonly Run[],
      },
      runLifecycleEvents: new RunLifecycleEvents(),
      logger: NOOP_LOGGER,
    });
    expect(source.snapshot().sessions.map((session) => session.runId)).toEqual(['a']);
  });

  it('delivers every update after observe() in revision order', () => {
    const { register, runs, events, source } = setup();
    register(fakeRun('a'));
    const updates: LocalSessionUpdate[] = [];
    const { snapshot } = source.observe((update) => updates.push(update));

    const run = required(runs.get('a'));
    run.effectiveState = {
      agentSessionId: run.agentSessionId,
      currentState: 'PLAN_READY',
      observedAt: '2026-10-04T00:00:01.000Z',
    };
    events.publishRunUpdated('a');
    events.publishRunUpdated('a');
    register(fakeRun('b'));

    expect(snapshot.revision).toBe(1);
    expect(updates.map((update) => [update.revision, update.kind])).toEqual([
      [2, 'updated'],
      [3, 'registered'],
    ]);
    expect(updates[0]).toMatchObject({
      session: { effectiveState: { state: 'PLAN_READY', observedAt: '2026-10-04T00:00:01.000Z' } },
    });
  });

  it('reports a replacement Run as removal of the old instance then a new registration', () => {
    const { register, source } = setup();
    register(fakeRun('a'));
    const firstInstance = required(source.snapshot().sessions[0]).runInstanceId;
    const updates: LocalSessionUpdate[] = [];
    source.observe((update) => updates.push(update));

    register(fakeRun('a'));

    expect(updates).toEqual([
      expect.objectContaining({ kind: 'removed', runId: 'a', runInstanceId: firstInstance }),
      expect.objectContaining({ kind: 'registered' }),
    ]);
    expect(required(source.snapshot().sessions[0]).runInstanceId).not.toBe(firstInstance);
  });

  it('ignores late updates for a Run that is no longer registered', () => {
    const { register, remove, events, source } = setup();
    register(fakeRun('a'));
    remove('a');
    const observer = vi.fn();
    source.observe(observer);

    events.publishRunUpdated('a');
    events.publishRunRemoved('a');

    expect(observer).not.toHaveBeenCalled();
    expect(source.snapshot().sessions).toEqual([]);
  });

  it('keeps delivering to healthy observers when one throws', () => {
    const { register, source } = setup();
    source.observe(() => {
      throw new Error('broken observer');
    });
    const healthy = vi.fn();
    source.observe(healthy);

    expect(() => register(fakeRun('a'))).not.toThrow();
    register(fakeRun('b'));
    expect(healthy).toHaveBeenCalledTimes(2);
  });

  it('keeps active work distinct from list membership', () => {
    const { register, runs, source } = setup();
    register(fakeRun('a'));
    expect(source.hasActiveWork()).toBe(false);
    expect(source.snapshot().sessions).toHaveLength(1);
    required(runs.get('a')).hasActiveWork = true;
    expect(source.hasActiveWork()).toBe(true);
  });

  it('stops observing lifecycle events after dispose', () => {
    const { register, source } = setup();
    const observer = vi.fn();
    source.observe(observer);
    source.dispose();
    register(fakeRun('a'));
    expect(observer).not.toHaveBeenCalled();
  });

  describe('with real Runs', () => {
    const setupRuns = () => {
      const events = new RunLifecycleEvents();
      const ownership = createTestRunOwnership();
      const logger = Object.assign(Object.create(NOOP_LOGGER) as typeof NOOP_LOGGER, {
        warn: vi.fn(),
      });
      const registry = new RunRegistry({
        runCollaborators: {
          runStore: createTestRunStore(),
          repoStore: createTestRepoMappingStore(),
          poster: createTestMessagePoster(),
          broadcaster: createTestRunEventPublisher(),
          handlerDeps: {} as never,
          promptTypeRegistry: ownership.promptTypeRegistry,
          submissionToolRegistry: ownership.submissionToolRegistry,
          runFollowUpAdmission: ownership.runFollowUpAdmission,
          runnerPicker: createTestRunnerPicker(),
          logger,
        },
        submissionToolRegistry: ownership.submissionToolRegistry,
        sessionRunnerFacade: createTestSessionRunnerFacade(),
        monitorProjectContext: createTestMonitorProjectContext(),
        runLifecycleEvents: events,
      });
      const source = new LocalSessionReadSource({
        runRegistry: registry,
        runLifecycleEvents: events,
        logger,
      });
      const create = (runId: string): Run => {
        const run = registry.create({
          runId,
          organizationId: 'test-org-id',
          projectId: 'test-project-id',
          conversationId: `conversation-${runId}`,
          provider: 'claude',
          session: baseSession(runId) as never,
        });
        // Stands in for the first Turn start, which lists the Run.
        (run as unknown as { _activeSince: string })._activeSince = '2026-10-07T00:00:00.000Z';
        events.publishRunUpdated(runId);
        return run;
      };
      const trace = () => {
        const seen: Array<[boolean, string | null]> = [];
        source.observe((update) => {
          if (update.kind === 'updated') {
            seen.push([update.session.hasActiveWork, update.session.providerSessionId]);
          }
        });
        return seen;
      };
      return { events, registry, source, create, trace, logger };
    };

    const baseSession = (runId: string) => ({
      id: runId,
      entity: null,
      provider_session_id: null,
      services: [{ id: 'test-service-id', path: '/tmp/repo' }],
      launchServiceId: 'test-service-id',
      conversationId: `conversation-${runId}`,
      contextMetadata: { organizationId: 'test-org-id', projectId: 'test-project-id' },
      events: [],
      createdAt: '2026-10-04T00:00:00.000Z',
    });

    const sessionOf = (source: LocalSessionReadSource, runId: string) =>
      required(source.snapshot().sessions.find((session) => session.runId === runId));

    it('signals queue add and drain', () => {
      const { create, trace, source } = setupRuns();
      const run = create('a');
      const seen = trace();
      run.enqueue({} as Parameters<Run['enqueue']>[0]);
      expect(sessionOf(source, 'a').hasActiveWork).toBe(true);
      run.dequeue();
      run.enqueue({} as Parameters<Run['enqueue']>[0]);
      run.clearQueue();
      expect(seen).toEqual([
        [true, null],
        [false, null],
        [true, null],
        [false, null],
      ]);
    });

    it('signals processing changes', () => {
      const { create, trace } = setupRuns();
      const run = create('a');
      const seen = trace();
      run.isProcessing = true;
      run.isProcessing = false;
      expect(seen).toEqual([
        [true, null],
        [false, null],
      ]);
    });

    it('signals pending completion and its flush', () => {
      const { create, trace } = setupRuns();
      const run = create('a');
      const seen = trace();
      const internals = run as unknown as {
        _pendingCompletion: object | null;
        _pendingCompletionFlush: Promise<void> | null;
      };
      internals._pendingCompletion = {};
      internals._pendingCompletion = null;
      internals._pendingCompletionFlush = Promise.resolve();
      internals._pendingCompletionFlush = null;
      expect(seen).toEqual([
        [true, null],
        [false, null],
        [true, null],
        [false, null],
      ]);
    });

    it('signals foreground subagent waits', () => {
      const { create, trace } = setupRuns();
      const run = create('a');
      const seen = trace();
      run.holdForSubagent('interaction');
      run.releaseSubagentHold('interaction');
      expect(seen).toEqual([
        [true, null],
        [false, null],
      ]);
    });

    it('signals scope review requests and their settlement', () => {
      const { create, trace } = setupRuns();
      const run = create('a');
      const seen = trace();
      run.serviceScope.recordServiceScopeRequest(
        { id: 'scope-request' } as Parameters<Run['serviceScope']['recordServiceScopeRequest']>[0],
        'message-id',
        {} as Parameters<Run['serviceScope']['recordServiceScopeRequest']>[2],
      );
      run.serviceScope.settleServiceScopeRequest('scope-request');
      expect(seen).toEqual([
        [true, null],
        [false, null],
      ]);
    });

    it('signals provider session id confirmation after the pending placeholder', () => {
      const { create, trace } = setupRuns();
      const run = create('a');
      const seen = trace();
      run.refreshSessionFields({ provider_session_id: 'pending_123' });
      run.isProcessing = true;
      run.refreshSessionFields({ provider_session_id: 'provider-1' });
      run.isProcessing = false;
      expect(seen).toEqual([
        [true, null],
        [true, 'provider-1'],
        [false, 'provider-1'],
      ]);
    });

    it('logs a failing snapshot build against that Run while it keeps executing', () => {
      const { create, source, logger } = setupRuns();
      const broken = create('broken');
      const healthy = create('healthy');
      Object.defineProperty(broken, 'effectiveState', {
        get: () => {
          throw new Error('projection failed');
        },
      });

      expect(() => {
        broken.isProcessing = true;
      }).not.toThrow();
      expect(broken.isProcessing).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        'local_session_read.reconcile_failed',
        expect.objectContaining({ runId: 'broken' }),
      );

      healthy.isProcessing = true;
      expect(sessionOf(source, 'healthy').hasActiveWork).toBe(true);
    });

    it('keeps the Run executing when a lifecycle listener throws', () => {
      const { create, events, logger } = setupRuns();
      const run = create('a');
      events.onRunUpdated(() => {
        throw new Error('listener failed');
      });
      expect(() => {
        run.isProcessing = true;
      }).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        'run-registry.run_updated_listener_failed',
        expect.objectContaining({ runId: 'a' }),
      );
    });
  });
});
