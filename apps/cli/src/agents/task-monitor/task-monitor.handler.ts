import type { AssistantCompleteEvent } from '../../run/types';
import {
  LocalPromptType,
  type TaskMonitorPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../../session/types';
import type { TaskMonitorConversationPromptPayload } from '../../shared/agent-bridge-contract/contract';
import type {
  CompletionValidationFailure,
  CompletionValidationResult,
  OnCompleteContext,
  OnCompleteDeps,
  OnInvalidCompletionContext,
  PrepareResult,
  PromptTypeHandler,
  PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import {
  loadTaskMonitorCanonicalEvidence,
  type TaskMonitorCanonicalEvidence,
} from './task-monitor-evidence';
import { parseTaskMonitorCoordinationLocalState } from './task-monitor-coordination';
import { buildTaskMonitorPrompt } from './task-monitor-prompt';
import { buildTaskMonitorConversationPrompt } from './task-monitor-conversation-prompt';
import { parseTaskMonitorDecision } from './task-monitor-response';

type TaskMonitorDecisionPromptInput = TaskMonitorPromptPayload & {
  _canonicalEvidence?: TaskMonitorCanonicalEvidence;
};
type TaskMonitorPromptInput = TaskMonitorDecisionPromptInput | TaskMonitorConversationPromptPayload;

const isConversationInput = (
  input: TaskMonitorPromptInput | undefined,
): input is TaskMonitorConversationPromptPayload =>
  input !== undefined && 'mode' in input && input.mode === 'CONVERSATION';

const publishInvalidDecision = (
  runId: string,
  deps: OnCompleteDeps,
  failure: CompletionValidationFailure,
  attemptId?: string,
): void => {
  deps.logger.warn('task_monitor.coordinator.decision.rejected', {
    runId,
    code: failure.code,
    message: failure.message,
    issues: failure.issues,
  });
  deps.taskMonitorDecisionStore.publish(
    runId,
    {
      status: 'INVALID',
      reason: failure.message,
      failure: {
        code: failure.code ?? 'INVALID_DECISION',
        message: failure.message,
        issues: [...(failure.issues ?? [])],
      },
    },
    attemptId,
  );
};

export const taskMonitorHandler: PromptTypeHandler<TaskMonitorPromptInput> = {
  id: 'task-monitor-coordinator',
  promptType: LocalPromptType.TaskMonitor,
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  allowsEmptyUserMessage: true,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  mcpToolUseCase: 'task_monitor',
  readOnlyFilesystem: true,
  builtinTools: [],
  omitServiceContextNote: true,

  async prepare(
    run: AgenticSession,
    payload: TaskMonitorPromptInput,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<TaskMonitorPromptInput>> {
    if (isConversationInput(payload)) {
      deps.logger.info('task_monitor.coordinator.conversation.prepared', {
        runId: run.agentic_session_id,
        taskMonitorId: payload.taskMonitorId,
        conversationId: payload.conversationId,
        sourceMessageId: payload.sourceMessageId,
      });
      return { payload };
    }
    const { organizationId, projectId } = run.contextMetadata ?? {};
    if (!organizationId || !projectId) {
      deps.logger.error('task_monitor.coordinator.evidence.context_missing', {
        runId: run.agentic_session_id,
        hasOrganizationId: Boolean(organizationId),
        hasProjectId: Boolean(projectId),
      });
      throw new Error('Task Monitor coordinator requires organization and project context.');
    }

    const persistedCoordination = run.sessionContext?.['taskMonitorCoordination'];
    const coordination = parseTaskMonitorCoordinationLocalState(persistedCoordination);
    if (
      persistedCoordination !== undefined &&
      persistedCoordination !== null &&
      coordination === null
    ) {
      throw new Error('Task Monitor coordination state is malformed or unsupported.');
    }
    const hasSettledTurn = payload.settledTurn !== undefined;
    if (payload.cause === 'CONTINUE') {
      if (!payload.settledTurn || payload.settledTurn.turnId !== payload.correlationId) {
        deps.logger.error('task_monitor.coordinator.evidence.turn_correlation_invalid', {
          runId: run.agentic_session_id,
          monitorId: payload.monitorId,
          correlationId: payload.correlationId,
          settledTurnId: payload.settledTurn?.turnId,
        });
        throw new Error('Task Monitor continuation requires matching settled Turn evidence.');
      }
    }
    if (
      payload.cause === 'JUDGMENT_RESOLVED' &&
      !hasSettledTurn &&
      !coordination?.activeRunAgentSessionId
    ) {
      throw new Error('Task Monitor coordination judgment requires an active Agent Session.');
    }
    if (
      payload.cause === 'RESUME' ||
      payload.cause === 'START' ||
      payload.cause === 'CONTINUE' ||
      payload.cause === 'JUDGMENT_RESOLVED'
    ) {
      deps.taskMonitorDecisionStore.bind(
        run.agentic_session_id,
        payload.correlationId,
        ...(payload.coordinatorAttemptId ? [payload.coordinatorAttemptId] : []),
      );
    }

    let accessToken: string;
    try {
      accessToken = await deps.auth.getAccessToken();
    } catch (error) {
      deps.logger.error('task_monitor.coordinator.evidence.auth_failed', {
        runId: run.agentic_session_id,
        monitorId: payload.monitorId,
        error,
      });
      throw error;
    }
    deps.logger.info('task_monitor.coordinator.evidence.load_started', {
      runId: run.agentic_session_id,
      monitorId: payload.monitorId,
    });
    let evidence: TaskMonitorCanonicalEvidence;
    try {
      evidence = await loadTaskMonitorCanonicalEvidence(deps, {
        organizationId,
        projectId,
        monitorId: payload.monitorId,
        accessToken,
        ...(payload.settledTurn ? { settledTurn: payload.settledTurn } : {}),
        ...(coordination ? { coordination } : {}),
      });
    } catch (error) {
      deps.logger.error('task_monitor.coordinator.evidence.load_failed', {
        runId: run.agentic_session_id,
        monitorId: payload.monitorId,
        cause: payload.cause,
        correlationId: payload.correlationId,
        error,
      });
      throw error;
    }
    deps.logger.info('task_monitor.coordinator.evidence.load_completed', {
      runId: run.agentic_session_id,
      monitorId: payload.monitorId,
      remainingTaskCount: evidence.remainingWork.length,
      reportCount: evidence.reports.length,
      turnId: evidence.releasedTurn?.turnId,
      hasCompletedAssistantMessage: evidence.releasedTurn?.completedAssistantMessage != null,
      selectedSessionStatus: evidence.selectedSession?.status,
      serviceIds: evidence.selectedSession?.serviceIds,
      launchServiceId: evidence.selectedSession?.launchServiceId,
    });
    return {
      payload: {
        ...payload,
        _canonicalEvidence: evidence,
      },
    };
  },

  buildPrompt(payload: TaskMonitorPromptInput): string {
    if (isConversationInput(payload)) return buildTaskMonitorConversationPrompt(payload);
    const { _canonicalEvidence: evidence, ...trigger } = payload;
    if (!evidence) {
      throw new Error(
        'Task Monitor coordinator prompt requires freshly loaded canonical evidence.',
      );
    }
    return buildTaskMonitorPrompt(trigger, evidence);
  },

  buildStartingMessage(): string {
    return 'Reviewing canonical Task Monitor evidence...';
  },

  validateCompletion(event: AssistantCompleteEvent, payload): CompletionValidationResult {
    if (isConversationInput(payload as TaskMonitorPromptInput)) return { ok: true };
    const result = parseTaskMonitorDecision(event.summary);
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  },

  transformCompletionOutput(event: AssistantCompleteEvent, payload) {
    if (isConversationInput(payload as TaskMonitorPromptInput)) {
      return {
        data: {
          type: 'AGENT',
          response: event.summary,
          detectedIntent: 'agent_response',
          intentConfidence: 1,
        },
      };
    }
    const result = parseTaskMonitorDecision(event.summary);
    if (!result.ok) return null;
    return {
      data: {
        type: 'AGENT',
        response: 'Applying the Task Monitor decision through canonical owners.',
        detectedIntent: 'agent_response',
        intentConfidence: 1,
      },
    };
  },

  async onInvalidCompletion(
    event: AssistantCompleteEvent,
    ctx: OnInvalidCompletionContext,
    deps: OnCompleteDeps,
    failure: CompletionValidationFailure,
  ): Promise<void> {
    if (isConversationInput(ctx.payload as TaskMonitorPromptInput)) return;
    const attemptId = (ctx.payload as TaskMonitorDecisionPromptInput | undefined)
      ?.coordinatorAttemptId;
    if (attemptId && !deps.taskMonitorDecisionStore.isCurrentAttempt(ctx.runId, attemptId)) return;
    if (attemptId)
      await deps.runStore.updateRunSessionContext(ctx.runId, {
        taskMonitorCoordinatorReceipt: { attemptId, output: event.summary },
      });
    publishInvalidDecision(
      ctx.runId,
      deps,
      failure,
      (ctx.payload as TaskMonitorDecisionPromptInput | undefined)?.coordinatorAttemptId,
    );
  },

  async onComplete(
    event: AssistantCompleteEvent,
    ctx: OnCompleteContext,
    deps: OnCompleteDeps,
  ): Promise<void> {
    if (isConversationInput(ctx.payload as TaskMonitorPromptInput)) return;
    const result = parseTaskMonitorDecision(event.summary);
    if (!result.ok) {
      const attemptId = (ctx.payload as TaskMonitorDecisionPromptInput | undefined)
        ?.coordinatorAttemptId;
      if (attemptId && !deps.taskMonitorDecisionStore.isCurrentAttempt(ctx.runId, attemptId))
        return;
      if (attemptId)
        await deps.runStore.updateRunSessionContext(ctx.runId, {
          taskMonitorCoordinatorReceipt: { attemptId, output: event.summary },
        });
      publishInvalidDecision(
        ctx.runId,
        deps,
        result.error,
        (ctx.payload as TaskMonitorDecisionPromptInput | undefined)?.coordinatorAttemptId,
      );
      return;
    }

    if (
      !deps.taskMonitorDecisionStore.reservePublication(
        ctx.runId,
        (ctx.payload as TaskMonitorDecisionPromptInput | undefined)?.coordinatorAttemptId,
      )
    )
      return;

    deps.logger.info('task_monitor.coordinator.decision.accepted', {
      runId: ctx.runId,
      action: result.value.action,
    });
    deps.taskMonitorDecisionStore.publish(
      ctx.runId,
      {
        status: 'DECISION',
        decision: result.value,
      },
      (ctx.payload as TaskMonitorDecisionPromptInput | undefined)?.coordinatorAttemptId,
    );
  },
};
