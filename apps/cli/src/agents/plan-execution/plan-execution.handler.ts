import type { AgenticSession } from '../../session/types';
import type { LocalPlanExecutionPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { AssistantCompleteEvent } from '../../run/types';
import type {
  OnCompleteContext,
  OnCompleteDeps,
  PrepareResult,
  PromptTypeHandler,
  PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import { buildPlanExecutionPrompt } from '../prompts/plan-execution';
import {
  formatPlanExecutionCompletionSummary,
  type PlanExecutionCompletionStep,
} from './completion-summary';

const PLAN_EXECUTION_SESSION_CONTEXT_KEY = 'planExecution.approvedExecutionPlan';

interface PlanExecutionSessionContext {
  executionPlan: PlanExecutionCompletionStep[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPlanExecutionCompletionStep = (value: unknown): value is PlanExecutionCompletionStep =>
  isRecord(value) && typeof value['stepId'] === 'string' && typeof value['title'] === 'string';

const readPlanExecutionSessionContext = (
  sessionContext: Record<string, unknown> | undefined,
): PlanExecutionSessionContext | null => {
  const rawExecutionPlan = sessionContext?.[PLAN_EXECUTION_SESSION_CONTEXT_KEY];
  if (!Array.isArray(rawExecutionPlan) || !rawExecutionPlan.every(isPlanExecutionCompletionStep)) {
    return null;
  }

  return {
    executionPlan: rawExecutionPlan.map(({ stepId, title }) => ({ stepId, title })),
  };
};

export const planExecutionHandler: PromptTypeHandler<LocalPlanExecutionPromptPayload> = {
  id: 'plan_execution',
  promptType: 'plan_execution',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],

  async prepare(
    run: AgenticSession,
    payload: LocalPlanExecutionPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalPlanExecutionPromptPayload>> {
    const executionPlan = payload.plan.executionPlan.map(({ stepId, title }) => ({
      stepId,
      title,
    }));

    deps.logger.info('plan_execution.prepare.approved_plan_stashed', {
      runId: run.agentic_session_id,
      executionPlanStepCount: executionPlan.length,
    });

    return {
      payload,
      sessionContext: {
        [PLAN_EXECUTION_SESSION_CONTEXT_KEY]: executionPlan,
      },
    };
  },

  buildPrompt(payload: LocalPlanExecutionPromptPayload): string {
    return buildPlanExecutionPrompt(payload);
  },

  async onComplete(
    event: AssistantCompleteEvent,
    ctx: OnCompleteContext,
    deps: OnCompleteDeps,
  ): Promise<void> {
    const run = await deps.runStore.getRun(ctx.runId);
    const sessionContext = readPlanExecutionSessionContext(run?.sessionContext);
    if (!sessionContext) {
      deps.logger.warn('plan_execution.on_complete.missing_approved_plan', {
        runId: ctx.runId,
        messageId: ctx.messageId,
      });
      return;
    }

    const completionSummary = formatPlanExecutionCompletionSummary(sessionContext);
    const response = event.summary ? `${event.summary}\n\n${completionSummary}` : completionSummary;

    deps.logger.info('plan_execution.on_complete.updating_summary', {
      runId: ctx.runId,
      messageId: ctx.messageId,
      executionPlanStepCount: sessionContext.executionPlan.length,
    });

    try {
      await deps.poster.update(
        ctx.organizationId,
        ctx.projectId,
        ctx.messageId,
        { data: { response } },
        ctx.stamp,
      );
      deps.logger.info('plan_execution.on_complete.summary_updated', {
        runId: ctx.runId,
        messageId: ctx.messageId,
      });
    } catch (error) {
      deps.logger.error('plan_execution.on_complete.summary_update_failed', {
        runId: ctx.runId,
        messageId: ctx.messageId,
        error,
      });
    }
  },
};
