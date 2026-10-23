import type { SessionMethod } from '../../shared/agent-bridge-contract/generated';
import {
  LocalPromptType,
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import { AgentSessionType, WorkflowName } from '../../shared/api/generated/api';
import type {
  SessionMonitorEvaluationStore,
  SessionMonitorEvaluationContext,
  SessionMonitorTurnEvaluationResult,
} from '../../agents/session-monitor';
import type { ServerLogger } from '../logger';
import type { LocalAgentService } from '../local-agent-service';
import type { PlatformAuth } from '../platform-auth-context';
import type { AgentSessionReader } from './agent-session-reader';
import type { CanonicalSettledTurnMonitorEvent } from './normalizer';

const DEFAULT_EVALUATION_TIMEOUT_MS = 5 * 60 * 1000;

interface SessionMonitorRunConfig {
  provider: LocalRunProvider;
  model: string;
  reasoningEffort: LocalReasoningEffort;
  method: SessionMethod;
}

export type { SessionMonitorTurnEvaluationResult } from '../../agents/session-monitor';

export interface SessionMonitorTurnEvaluatorDependencies {
  agentService: LocalAgentService;
  agentSessionReader: AgentSessionReader;
  evaluationStore: SessionMonitorEvaluationStore;
  reportTypeSubscription: readonly string[];
  runConfig: SessionMonitorRunConfig;
  logger: ServerLogger;
  timeoutMs?: number;
}

/** Owns one settled-Turn Session Monitor invocation and its typed result. */
export class SessionMonitorTurnEvaluator {
  private readonly subscribedReportTypes: ReadonlySet<string>;

  public constructor(private readonly dependencies: SessionMonitorTurnEvaluatorDependencies) {
    this.subscribedReportTypes = new Set(dependencies.reportTypeSubscription);
  }

  public async evaluate(
    event: CanonicalSettledTurnMonitorEvent,
    auth: PlatformAuth,
  ): Promise<SessionMonitorTurnEvaluationResult> {
    try {
      return await this.evaluateOnce(event, auth);
    } catch (error) {
      this.dependencies.logger.error('session_monitor.settled_turn.evaluation.crashed', {
        targetSessionId: event.agentSessionId,
        turnId: event.turnId,
        error,
      });
      return this.failed(event, 'SESSION_MONITOR_EVALUATION_FAILED');
    }
  }

  private async evaluateOnce(
    event: CanonicalSettledTurnMonitorEvent,
    auth: PlatformAuth,
  ): Promise<SessionMonitorTurnEvaluationResult> {
    const { agentService, agentSessionReader, evaluationStore, logger } = this.dependencies;
    logger.info('session_monitor.settled_turn.evaluation.started', {
      targetSessionId: event.agentSessionId,
      turnId: event.turnId,
      reportCount: event.reports.length,
    });

    const session = await agentSessionReader.readAgentSession(event.agentSessionId);
    if (!session?.conversationId) {
      return this.failed(event, 'SESSION_MONITOR_TARGET_SESSION_UNRESOLVABLE');
    }
    if (session.autoDecide !== true) {
      return this.released(event, 'SESSION_MONITOR_NOT_CONFIGURED');
    }
    const matchingReports = event.reports.filter(({ reportType }) =>
      this.subscribedReportTypes.has(reportType),
    );
    if (matchingReports.length === 0) {
      return this.released(event, 'SESSION_MONITOR_NO_SUBSCRIBED_REPORT');
    }

    const conversationId = session.conversationId;
    const [workflow, completedAssistantMessage] = await Promise.all([
      agentService.readWorkflowVerdict({
        organizationId: auth.organizationId,
        projectId: auth.projectId,
        conversationId,
      }),
      event.completedAssistantMessageId
        ? agentService.readAssistantMessage({
            organizationId: auth.organizationId,
            projectId: auth.projectId,
            conversationId,
            messageId: event.completedAssistantMessageId,
          })
        : Promise.resolve(null),
    ]);
    if (event.completedAssistantMessageId && !completedAssistantMessage) {
      return this.failed(event, 'SESSION_MONITOR_ASSISTANT_MESSAGE_UNRESOLVABLE');
    }

    const reports = matchingReports.map(({ reportId, reportType }) =>
      Object.freeze({ reportId, reportType }),
    );
    Object.freeze(reports);
    const availableActions = [...(workflow.availableActions ?? [])];
    Object.freeze(availableActions);
    const context = Object.freeze({
      targetSessionId: event.agentSessionId,
      targetConversationId: conversationId,
      turnId: event.turnId,
      completedAssistantContent: completedAssistantMessage?.content ?? null,
      reports,
      workflow: Object.freeze({
        state: workflow.state,
        promptType: workflow.promptType,
        nodeId: workflow.state === 'agent-pending' ? workflow.externalAgentNodeId : null,
        triggerMessageId: workflow.state === 'agent-pending' ? workflow.triggerMessageId : null,
      }),
      availableActions,
    }) satisfies Readonly<SessionMonitorEvaluationContext>;

    const { run } = await agentService.ensureRunForMonitor({
      accessToken: auth.accessToken,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      promptType: LocalPromptType.SessionMonitor,
      agentSessionType: AgentSessionType.SessionMonitor,
      workflowType: WorkflowName.SessionMonitor,
      contextMetadataSeed: {
        capturedAt: new Date().toISOString(),
        organizationId: auth.organizationId,
        projectId: auth.projectId,
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
      runConfig: this.dependencies.runConfig,
      keyBy: {
        mode: 'targetSession',
        targetSessionId: event.agentSessionId,
        targetConversationId: conversationId,
      },
    });
    const monitorRunId = run.agentic_session_id;
    const resultPromise = evaluationStore.begin(monitorRunId, context);
    const timeout = setTimeout(() => {
      logger.warn('session_monitor.settled_turn.evaluation.slow', {
        targetSessionId: event.agentSessionId,
        turnId: event.turnId,
        monitorRunId,
        timeoutMs: this.dependencies.timeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS,
      });
    }, this.dependencies.timeoutMs ?? DEFAULT_EVALUATION_TIMEOUT_MS);
    void agentService
      .sendSystemMessage(monitorRunId, {
        promptType: LocalPromptType.SessionMonitor,
        payload: {
          promptType: LocalPromptType.SessionMonitor,
          entity: { entityType: 'AGENT_SESSION', entityId: event.agentSessionId },
          targetSessionId: context.targetSessionId,
          settledTurn: {
            turnId: context.turnId,
            promptType: event.promptType,
            terminalOutcome: event.terminalOutcome,
            completedAssistantMessage: completedAssistantMessage
              ? {
                  messageId: completedAssistantMessage.messageId,
                  content: completedAssistantMessage.content,
                }
              : null,
            reports: [...context.reports],
          },
          workflowContext: {
            state: context.workflow.state,
            promptType: context.workflow.promptType,
            nodeId: context.workflow.nodeId,
            triggerMessageId: context.workflow.triggerMessageId,
            actions: [...context.availableActions],
          },
        },
        references: { resolved: [], unresolved: [] },
      })
      .catch((error) => {
        evaluationStore.fail(monitorRunId, 'SESSION_MONITOR_RUN_FAILED');
        logger.error('session_monitor.settled_turn.run.failed', {
          targetSessionId: event.agentSessionId,
          turnId: event.turnId,
          monitorRunId,
          error,
        });
      });
    try {
      const result = await resultPromise;
      logger.info('session_monitor.settled_turn.evaluation.completed', {
        targetSessionId: event.agentSessionId,
        turnId: event.turnId,
        monitorRunId,
        resultStatus: result.status,
      });
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private failed(
    event: CanonicalSettledTurnMonitorEvent,
    reason: string,
  ): SessionMonitorTurnEvaluationResult {
    this.dependencies.logger.error('session_monitor.settled_turn.evaluation.failed', {
      targetSessionId: event.agentSessionId,
      turnId: event.turnId,
      reason,
    });
    return { status: 'FAILED', reason };
  }

  private released(
    event: CanonicalSettledTurnMonitorEvent,
    reason: string,
  ): SessionMonitorTurnEvaluationResult {
    this.dependencies.logger.info('session_monitor.settled_turn.evaluation.released', {
      targetSessionId: event.agentSessionId,
      turnId: event.turnId,
      reason,
    });
    return { status: 'RELEASED', reason };
  }
}
