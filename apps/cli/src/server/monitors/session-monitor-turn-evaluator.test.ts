import { describe, expect, it, vi } from 'vitest';
import { SessionMonitorEvaluationStore } from '../../agents/session-monitor';
import { ReportType } from '../../shared/api/generated/api';
import {
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import { SessionMethod } from '../../shared/agent-bridge-contract/generated';
import type { LocalAgentService } from '../local-agent-service';
import { NOOP_LOGGER } from '../logger';
import type { PlatformAuth } from '../platform-auth-context';
import { MessageService } from '../services/message.service';
import { SETTLED_TURN_EVENT_KIND, type CanonicalSettledTurnMonitorEvent } from './normalizer';
import { createTestAgentSessionReader } from './test-owners.test-support';
import { SessionMonitorTurnEvaluator } from './session-monitor-turn-evaluator';

const AUTH: PlatformAuth = {
  accessToken: 'token',
  organizationId: 'org-1',
  projectId: 'project-1',
  userId: 'user-1',
};

const event = (reports: CanonicalSettledTurnMonitorEvent['reports'] = []) => ({
  kind: SETTLED_TURN_EVENT_KIND,
  eventType: SETTLED_TURN_EVENT_KIND,
  eventId: 'turn-1',
  entityId: 'target-session',
  agentSessionId: 'target-session',
  runId: 'target-session',
  turnId: 'turn-1',
  promptType: 'plan_shaping_feature_sync_analyze',
  terminalOutcome: 'COMPLETED' as const,
  completedAssistantMessageId: 'assistant-message',
  reports,
  settledAt: '2026-07-31T00:00:00.000Z',
  timestamp: '2026-07-31T00:00:00.000Z',
  origin: 'self' as const,
});

const RUN_CONFIG = {
  provider: LocalRunProvider.Codex,
  model: 'gpt-5.6-luna',
  reasoningEffort: LocalReasoningEffort.Xhigh,
  method: SessionMethod.Quick,
};

const harness = (autoDecide = true) => {
  const evaluationStore = new SessionMonitorEvaluationStore(NOOP_LOGGER);
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => NOOP_LOGGER),
  };
  const ensureRunForMonitor = vi.fn(async () => ({
    created: false,
    run: { agentic_session_id: 'monitor-run' },
    agentSessionId: 'monitor-session',
    ownConversationId: 'monitor-conversation',
  }));
  const sendMessage = vi.fn(async () => {
    evaluationStore.resolve('monitor-run', { status: 'HANDLED', outcome: 'CONTINUED' });
    return {};
  });
  const stopRun = vi.fn(async () => undefined);
  const agentService = {
    ensureRunForMonitor,
    sendSystemMessage: sendMessage,
    stopRun,
    readWorkflowVerdict: vi.fn(async () => ({
      state: 'agent-pending' as const,
      promptType: 'plan_shaping_finalize',
      externalAgentNodeId: 'review-plan',
      triggerMessageId: 'workflow-trigger',
      availableActions: ['APPROVED', 'REVISED'],
    })),
    readAssistantMessage: vi.fn(async () => ({
      messageId: 'assistant-message',
      content: 'Which option should be canonical?',
    })),
  } as unknown as LocalAgentService;
  const evaluator = new SessionMonitorTurnEvaluator({
    agentService,
    agentSessionReader: createTestAgentSessionReader(async () => ({
      conversationId: 'target-conversation',
      autoDecide,
      config: null,
    })),
    evaluationStore,
    reportTypeSubscription: [
      ReportType.Plan,
      ReportType.FeatureSyncDecision,
      ReportType.FeatureSyncHandoff,
      ReportType.DecisionNeeded,
    ],
    runConfig: RUN_CONFIG,
    logger,
    timeoutMs: 50,
  });
  return {
    evaluator,
    evaluationStore,
    ensureRunForMonitor,
    sendMessage,
    stopRun,
    agentService,
    logger,
  };
};

describe('SessionMonitorTurnEvaluator', () => {
  it('releases before evidence reads when no subscribed Report exists', async () => {
    const test = harness();
    await expect(test.evaluator.evaluate(event(), AUTH)).resolves.toEqual({
      status: 'RELEASED',
      reason: 'SESSION_MONITOR_NO_SUBSCRIBED_REPORT',
    });
    expect(test.agentService.readWorkflowVerdict).not.toHaveBeenCalled();
    expect(test.agentService.readAssistantMessage).not.toHaveBeenCalled();
    expect(test.ensureRunForMonitor).not.toHaveBeenCalled();
  });

  it('builds one canonical evaluation with all subscribed Reports and current actions', async () => {
    const test = harness();
    await test.evaluator.evaluate(
      event([
        { reportId: 'report-1', reportType: ReportType.DecisionNeeded },
        { reportId: 'report-2', reportType: ReportType.Plan },
        { reportId: 'report-3', reportType: ReportType.Implement },
      ]),
      AUTH,
    );
    expect(test.sendMessage).toHaveBeenCalledWith(
      'monitor-run',
      expect.objectContaining({
        payload: expect.objectContaining({
          targetSessionId: 'target-session',
          settledTurn: {
            turnId: 'turn-1',
            promptType: 'plan_shaping_feature_sync_analyze',
            terminalOutcome: 'COMPLETED',
            completedAssistantMessage: {
              messageId: 'assistant-message',
              content: 'Which option should be canonical?',
            },
            reports: [
              { reportId: 'report-1', reportType: ReportType.DecisionNeeded },
              { reportId: 'report-2', reportType: ReportType.Plan },
            ],
          },
          workflowContext: {
            state: 'agent-pending',
            promptType: 'plan_shaping_finalize',
            nodeId: 'review-plan',
            triggerMessageId: 'workflow-trigger',
            actions: ['APPROVED', 'REVISED'],
          },
        }),
      }),
    );
    expect(test.ensureRunForMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        runConfig: RUN_CONFIG,
      }),
    );
    const runConfig = vi.mocked(test.agentService.ensureRunForMonitor).mock.calls[0]![0].runConfig;
    expect(runConfig).not.toHaveProperty('serviceIds');
    expect(runConfig).not.toHaveProperty('launchServiceId');
    expect(runConfig).not.toHaveProperty('scope');
    expect(runConfig).not.toHaveProperty('worktree');
  });

  it('explicitly releases when automatic decisions are disabled', async () => {
    const test = harness(false);
    await expect(
      test.evaluator.evaluate(
        event([{ reportId: 'report-1', reportType: ReportType.DecisionNeeded }]),
        AUTH,
      ),
    ).resolves.toEqual({
      status: 'RELEASED',
      reason: 'SESSION_MONITOR_NOT_CONFIGURED',
    });
    expect(test.agentService.readWorkflowVerdict).not.toHaveBeenCalled();
  });

  it('fails closed when the canonical assistant Message cannot be read', async () => {
    const test = harness();
    vi.mocked(test.agentService.readAssistantMessage).mockResolvedValue(null);
    await expect(
      test.evaluator.evaluate(
        event([{ reportId: 'report-1', reportType: ReportType.DecisionNeeded }]),
        AUTH,
      ),
    ).resolves.toEqual({
      status: 'FAILED',
      reason: 'SESSION_MONITOR_ASSISTANT_MESSAGE_UNRESOLVABLE',
    });
    expect(test.ensureRunForMonitor).not.toHaveBeenCalled();
  });

  it('reports a slow monitor Run without manufacturing an evaluation result', async () => {
    const test = harness();
    test.sendMessage.mockImplementation(async () => ({}) as never);
    let settled = false;
    const evaluation = test.evaluator
      .evaluate(event([{ reportId: 'report-1', reportType: ReportType.DecisionNeeded }]), AUTH)
      .then((result) => {
        settled = true;
        return result;
      });

    await vi.waitFor(() => expect(test.sendMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(test.logger.warn).toHaveBeenCalledWith(
        'session_monitor.settled_turn.evaluation.slow',
        expect.objectContaining({ monitorRunId: 'monitor-run', timeoutMs: 50 }),
      ),
    );
    expect(settled).toBe(false);
    expect(test.stopRun).not.toHaveBeenCalled();

    test.evaluationStore.resolve('monitor-run', {
      status: 'HANDLED',
      outcome: 'CONTINUED',
    });
    await expect(evaluation).resolves.toEqual({ status: 'HANDLED', outcome: 'CONTINUED' });
  });
});

describe('Session Monitor assistant Message read', () => {
  it('reads canonical assistant content from a SYSTEM/AGENT Message response', async () => {
    const service = new MessageService({
      logger: NOOP_LOGGER,
      runService: {} as never,
      runRegistry: {} as never,
      promptTypeRegistry: {} as never,
      workflowsApi: {} as never,
      messagesApi: {
        getMessage: vi.fn(async () => ({
          data: {
            data: {
              id: 'assistant-message',
              projectId: 'project-1',
              conversationId: 'target-conversation',
              type: 'SYSTEM',
              data: {
                type: 'AGENT',
                response: 'Which option should be canonical?',
              },
            },
          },
        })),
      },
    });

    await expect(
      service.readAssistantMessage({
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'target-conversation',
        messageId: 'assistant-message',
      }),
    ).resolves.toEqual({
      messageId: 'assistant-message',
      content: 'Which option should be canonical?',
    });
  });

  it('rejects a non-agent SYSTEM Message as assistant evidence', async () => {
    const service = new MessageService({
      logger: NOOP_LOGGER,
      runService: {} as never,
      runRegistry: {} as never,
      promptTypeRegistry: {} as never,
      workflowsApi: {} as never,
      messagesApi: {
        getMessage: vi.fn(async () => ({
          data: {
            data: {
              id: 'trigger-message',
              type: 'SYSTEM',
              data: { type: 'QUESTIONS', response: 'Choose one.' },
            },
          },
        })),
      },
    });

    await expect(
      service.readAssistantMessage({
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'target-conversation',
        messageId: 'trigger-message',
      }),
    ).resolves.toBeNull();
  });
});

describe('Session Monitor workflow verdict read', () => {
  it('treats an omitted action vocabulary as response-only continuation', async () => {
    const service = new MessageService({
      logger: NOOP_LOGGER,
      runService: {} as never,
      runRegistry: {} as never,
      promptTypeRegistry: {} as never,
      workflowsApi: {
        getConversationPromptType: vi.fn(async () => ({
          data: {
            data: {
              workflowState: 'agent-pending' as const,
              promptType: 'plan_shaping_finalize',
              nodeId: 'approve-plan',
              triggerMessageId: 'trigger-message',
            },
          },
        })),
      },
      messagesApi: {} as never,
    });

    await expect(
      service.readWorkflowVerdict({
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'target-conversation',
      }),
    ).resolves.toEqual({
      state: 'agent-pending',
      promptType: 'plan_shaping_finalize',
      externalAgentNodeId: 'approve-plan',
      triggerMessageId: 'trigger-message',
      availableActions: [],
    });
  });

  it('rejects a present action vocabulary containing an empty action', async () => {
    const service = new MessageService({
      logger: NOOP_LOGGER,
      runService: {} as never,
      runRegistry: {} as never,
      promptTypeRegistry: {} as never,
      workflowsApi: {
        getConversationPromptType: vi.fn(async () => ({
          data: {
            data: {
              workflowState: 'agent-pending' as const,
              promptType: 'plan_shaping_finalize',
              nodeId: 'approve-plan',
              triggerMessageId: 'trigger-message',
              actions: [''],
            },
          },
        })),
      },
      messagesApi: {} as never,
    });

    await expect(
      service.readWorkflowVerdict({
        organizationId: 'org-1',
        projectId: 'project-1',
        conversationId: 'target-conversation',
      }),
    ).rejects.toThrow('Workflow verdict included an invalid current action vocabulary.');
  });
});
