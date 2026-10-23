import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { AgentSessionCurrentState } from '../../shared/api/generated/api';
import type { AgenticSession } from '../../session/types';
import { NOOP_LOGGER } from '../../server/logger';
import { TaskMonitorManagedTurnRuntime } from '../../server/task-monitor-managed-turn-runtime';
import type { Runner } from '../../turn/turn';
import type { Run } from '../run';
import {
  createTestMessagePoster,
  createTestRun,
  createTestRunEventPublisher,
  createTestRunStore,
  createTestRunnerPicker,
} from '../run.test-support';
import type { RunnerContext } from '../runners/types';
import type { LocalAgentOutputEvent } from '../types';
import {
  RUN_CONFORMANCE_PROTOCOL,
  observationSchema,
  type RunConformanceExternalOutcome,
  type RunConformanceInput,
  type RunConformanceInterruptionBoundary,
  type RunConformanceObservation,
  type RunConformancePendingOperation,
  type RunConformanceProviderOutput,
} from './protocol';
import { runConformanceScenario } from './scenario-runner';
import { RUN_CONFORMANCE_REGRESSION_SCENARIOS } from './scenarios';
import {
  TypeScriptRunConformanceDriver,
  type TypeScriptRunConformanceBoundary,
} from './typescript-run-adapter';

const toEffectiveState = (
  state: AgentSessionCurrentState,
): RunConformanceObservation['effectiveState'] => {
  switch (state) {
    case 'IDLE':
      return 'idle';
    case 'STARTING':
      return 'starting';
    case 'THINKING':
      return 'thinking';
    case 'WRITING':
      return 'writing';
    case 'AWAITING_APPROVAL':
      return 'awaiting_approval';
    case 'PLAN_READY':
    case 'IMPLEMENTATION_READY':
      return 'idle';
  }
  throw new Error('Unsupported Agent Session current state.');
};

class ControlledRunner implements Runner {
  private resolve: (() => void) | null = null;
  private reject: ((error: Error) => void) | null = null;

  public run(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  public settle(outcome: RunConformanceExternalOutcome): void {
    if (outcome.kind === 'failed' || outcome.kind === 'capacity') {
      this.reject?.(new Error(outcome.kind));
      return;
    }
    this.resolve?.();
  }
}

class ConcreteTypeScriptRunBoundary implements TypeScriptRunConformanceBoundary {
  private readonly run: Run;

  private readonly runners: ControlledRunner[] = [];
  private readonly pendingOperations: RunConformancePendingOperation[] = [];
  private readonly outputEvents: RunConformanceObservation['outputEvents'] = [];
  private readonly terminalTurns: RunConformanceObservation['terminalTurns'] = [];
  private readonly publications: string[] = [];
  private readonly queuedInputIds: string[] = [];
  private effectiveState: RunConformanceObservation['effectiveState'] = 'idle';
  private currentInput: RunConformanceInput | null = null;
  private currentTurnId: string | null = null;
  private nextOperation = 1;

  public constructor() {
    const session = {
      entity: null,
      agentic_session_id: 'test-run-id',
      provider: 'claude',
      provider_session_id: null,
      provider_conversation_id: null,
      status: 'ACTIVE',
      services: [{ id: 'test-service-id', path: '/tmp/repo' }],
      launchServiceId: 'test-service-id',
      conversationId: 'test-conversation-id',
      contextMetadata: { organizationId: 'test-org-id', projectId: 'test-project-id' },
      events: [],
    } as unknown as AgenticSession;
    const runStore = createTestRunStore();
    vi.spyOn(runStore, 'updateRunPromptType').mockResolvedValue(session);
    vi.spyOn(runStore, 'updateRunSessionContext').mockResolvedValue(session);
    vi.spyOn(runStore, 'getTouchedFiles').mockResolvedValue([]);
    vi.spyOn(runStore, 'addTouchedFiles').mockResolvedValue(undefined);
    vi.spyOn(runStore, 'addToolUsage').mockResolvedValue(undefined);
    const taskMonitorManagedTurnRuntime = new TaskMonitorManagedTurnRuntime(NOOP_LOGGER);
    taskMonitorManagedTurnRuntime.subscribe((event) => {
      this.publications.push(event.turnId);
      this.terminalTurns.push({
        turnId: event.turnId,
        outcome:
          event.terminalOutcome === 'COMPLETED'
            ? 'completed'
            : event.terminalOutcome === 'FAILED'
              ? 'failed'
              : 'aborted',
        assistantMessageId: event.completedAssistantMessageId,
        reportIds: event.reports.map(({ reportId }) => reportId),
      });
    });
    const broadcaster = createTestRunEventPublisher({
      emitAgentSessionCurrentStateObservation: ({ currentState }) => {
        this.effectiveState = toEffectiveState(currentState);
      },
      publishAgentOutput: (event) => this.observeAgentOutput(event),
    });
    const poster = createTestMessagePoster({
      createOutOfBand: () => Promise.resolve(`message-${String(this.outputEvents.length)}`),
    });
    const runnerPicker = createTestRunnerPicker((ctx: RunnerContext) => {
      const runner = new ControlledRunner();
      this.runners.push(runner);
      this.currentTurnId = ctx.turnId ?? `turn-${String(this.runners.length)}`;
      this.pendingOperations.push({
        operationId: `agent_turn-${String(this.nextOperation++)}`,
        kind: 'agent_turn',
        turnId: this.currentTurnId,
        correlationId: this.currentInput?.inputId ?? null,
        reportType: null,
      });
      return runner;
    });
    this.run = createTestRun(
      { session, skipProjectAssistant: true },
      { runStore, broadcaster, poster, runnerPicker, taskMonitorManagedTurnRuntime },
    );
  }

  public async handleInput(input: RunConformanceInput): Promise<void> {
    this.queuedInputIds.push(input.inputId);
    const runInput: InternalRunPromptRequest = {
      promptType: LocalPromptType.CodingFreeform,
      payload: { promptType: LocalPromptType.CodingFreeform, userMessage: input.prompt },
      references: { resolved: [], unresolved: [] },
      triggerContext: input.trigger
        ? {
            externalAgentNodeId: input.trigger.nodeId,
            triggerMessageId: input.trigger.messageId,
          }
        : null,
    };
    await this.run.handleMessage(runInput, {
      sourceUserMessageId: input.inputId,
      onTurnStarted: (turnId) => {
        this.currentInput = input;
        this.currentTurnId = turnId;
        const queuedIndex = this.queuedInputIds.indexOf(input.inputId);
        if (queuedIndex >= 0) this.queuedInputIds.splice(queuedIndex, 1);
      },
    });
  }

  public async emitProviderOutput(output: RunConformanceProviderOutput): Promise<void> {
    const timestamp = new Date().toISOString();
    if (output.kind === 'thinking' || output.kind === 'writing') {
      this.run.onAgentOutput({
        event: {
          source: 'local',
          eventType: 'processing_status',
          timestamp,
          sessionId: null,
          agentId: 'conformance-provider',
          payload: { kind: 'loading.update', loadingText: output.kind, phase: output.kind },
        },
      });
    } else {
      this.run.onAgentOutput({
        event: {
          source: 'provider',
          eventType: 'agent_output',
          timestamp,
          sessionId: null,
          agentId: 'conformance-provider',
          payload: {
            messageType: 'assistant',
            taskComplete: output.kind === 'assistant_complete',
            summary: output.text,
          },
        },
      });
    }
    await vi.waitFor(() => {
      if (output.kind === 'thinking' || output.kind === 'writing') {
        expect(this.effectiveState).toBe(output.kind);
      } else {
        expect(this.outputEvents.at(-1)).toEqual({ kind: output.kind, text: output.text });
      }
    });
  }

  public async stop(): Promise<void> {
    await this.run.stop();
    await this.run.awaitIdle();
    this.pendingOperations.length = 0;
    this.queuedInputIds.length = 0;
    this.currentInput = null;
    this.currentTurnId = null;
  }

  public async settleExternalOperation(
    operationId: string,
    outcome: RunConformanceExternalOutcome,
  ): Promise<void> {
    const index = this.pendingOperations.findIndex(
      (operation) => operation.operationId === operationId,
    );
    if (index < 0) return;
    const [operation] = this.pendingOperations.splice(index, 1);
    if (operation?.kind !== 'agent_turn') {
      throw new Error(`Unsupported concrete settlement kind: ${operation?.kind ?? 'missing'}`);
    }
    const priorPublicationCount = this.publications.length;
    const priorRunnerCount = this.runners.length;
    this.runners.at(-1)?.settle(outcome);
    await vi.waitFor(() => expect(this.publications.length).toBeGreaterThan(priorPublicationCount));
    await vi.waitFor(() => {
      expect(this.effectiveState === 'idle' || this.runners.length > priorRunnerCount).toBe(true);
    });
  }

  public interruptAt(boundary: RunConformanceInterruptionBoundary): Promise<void> {
    void boundary;
    return Promise.reject(
      new Error('Process interruption is not supported by the in-process Run boundary.'),
    );
  }

  public reapIdle(): Promise<void> {
    return Promise.reject(
      new Error('Idle reaping requires the registry-backed conformance boundary.'),
    );
  }

  public crash(): Promise<void> {
    return Promise.reject(
      new Error('Crash/restart requires the process-backed conformance boundary.'),
    );
  }

  public restart(): Promise<TypeScriptRunConformanceBoundary> {
    return Promise.reject(
      new Error('Crash/restart requires the process-backed conformance boundary.'),
    );
  }

  public observe(): RunConformanceObservation {
    const currentInput = this.currentInput;
    const active = this.effectiveState !== 'idle' && currentInput !== null;
    return observationSchema.parse({
      protocol: RUN_CONFORMANCE_PROTOCOL,
      availability: 'running',
      phase: active ? 'active' : 'idle',
      effectiveState: this.effectiveState,
      outputEvents: this.outputEvents,
      activeTurn:
        active && this.currentTurnId
          ? {
              turnId: this.currentTurnId,
              inputId: currentInput.inputId,
              trigger: currentInput.trigger,
            }
          : null,
      queuedInputIds: this.queuedInputIds,
      providerSessionId: null,
      providerSessionHistory: [],
      pendingOperations: this.pendingOperations,
      terminalTurns: this.terminalTurns,
      settledTurnPublications: this.publications,
      rejectedSettlements: [],
    });
  }

  public async dispose(): Promise<void> {
    await this.run.stop();
    await this.run.awaitIdle();
    this.run.cleanup();
  }

  private observeAgentOutput(event: LocalAgentOutputEvent): void {
    if (event.eventType !== 'agent_output' || event.payload['messageType'] !== 'assistant') return;
    const text = event.payload['summary'];
    if (typeof text !== 'string') return;
    this.outputEvents.push({
      kind: event.payload['taskComplete'] === true ? 'assistant_complete' : 'assistant_delta',
      text,
    });
  }
}

describe('TypeScript Run conformance adapter', () => {
  const boundaries: ConcreteTypeScriptRunBoundary[] = [];

  afterEach(async () => {
    await Promise.all(boundaries.splice(0).map((boundary) => boundary.dispose()));
  });

  it('runs the portable output/state scenario against the concrete Run boundary', async () => {
    const scenario = RUN_CONFORMANCE_REGRESSION_SCENARIOS.find(({ name }) =>
      name.startsWith('provider output drives'),
    );
    expect(scenario).toBeDefined();
    if (!scenario) throw new Error('The output/state conformance scenario is missing.');
    const boundary = new ConcreteTypeScriptRunBoundary();
    boundaries.push(boundary);

    const result = await runConformanceScenario(
      new TypeScriptRunConformanceDriver(boundary),
      scenario,
    );

    expect(result.finalObservation).toMatchObject({
      effectiveState: 'writing',
      outputEvents: [
        { kind: 'assistant_delta', text: 'Working on it.' },
        { kind: 'assistant_complete', text: 'Done.' },
      ],
    });
    expect(result.observations.map(({ effectiveState }) => effectiveState)).toEqual([
      'starting',
      'thinking',
      'writing',
      'writing',
      'writing',
    ]);
  });

  it('observes the real final Message and settled-Turn publication after the runner returns', async () => {
    const boundary = new ConcreteTypeScriptRunBoundary();
    boundaries.push(boundary);
    const driver = new TypeScriptRunConformanceDriver(boundary);
    const input: RunConformanceInput = {
      inputId: 'completion',
      prompt: 'complete the turn',
      trigger: null,
      requiredReportTypes: [],
    };

    await driver.execute({ kind: 'start', input });
    await driver.execute({
      kind: 'emit',
      output: { kind: 'assistant_complete', text: 'Finished.' },
    });
    const completed = await driver.execute({
      kind: 'settle',
      operationId: 'agent_turn-1',
      outcome: { kind: 'completed', assistantMessageId: 'message-1' },
    });

    expect(completed).toMatchObject({
      phase: 'idle',
      effectiveState: 'idle',
      terminalTurns: [
        {
          outcome: 'completed',
          assistantMessageId: 'message-1',
          reportIds: [],
        },
      ],
    });
    expect(completed.settledTurnPublications).toHaveLength(1);
  });

  it('observes FIFO release through real Turn settlement callbacks', async () => {
    const boundary = new ConcreteTypeScriptRunBoundary();
    boundaries.push(boundary);
    const driver = new TypeScriptRunConformanceDriver(boundary);
    const first: RunConformanceInput = {
      inputId: 'first',
      prompt: 'first',
      trigger: null,
      requiredReportTypes: [],
    };
    const second: RunConformanceInput = {
      inputId: 'second',
      prompt: 'second',
      trigger: null,
      requiredReportTypes: [],
    };

    await driver.execute({ kind: 'start', input: first });
    const queued = await driver.execute({ kind: 'admit', input: second });
    expect(queued).toMatchObject({
      activeTurn: { inputId: 'first' },
      queuedInputIds: ['second'],
    });

    const released = await driver.execute({
      kind: 'settle',
      operationId: 'agent_turn-1',
      outcome: { kind: 'completed', assistantMessageId: 'unused' },
    });
    expect(released).toMatchObject({
      activeTurn: { inputId: 'second' },
      queuedInputIds: [],
    });
    expect(released.settledTurnPublications).toHaveLength(1);
  });

  it('runs cancellation against Run.stop and proves queued work is cleared', async () => {
    const scenario = RUN_CONFORMANCE_REGRESSION_SCENARIOS.find(({ name }) =>
      name.startsWith('cancellation aborts'),
    );
    if (!scenario) throw new Error('The cancellation conformance scenario is missing.');
    const boundary = new ConcreteTypeScriptRunBoundary();
    boundaries.push(boundary);

    const result = await runConformanceScenario(
      new TypeScriptRunConformanceDriver(boundary),
      scenario,
    );

    expect(result.finalObservation).toMatchObject({
      phase: 'idle',
      activeTurn: null,
      queuedInputIds: [],
    });
    expect(result.finalObservation.settledTurnPublications).toHaveLength(1);
  });
});
