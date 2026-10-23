import type { AgenticSession } from '../../session/types';
import { z } from 'zod';
import {
  LocalPromptType,
  type SessionMonitorPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  type SessionMonitorDeferralReportPayload,
} from '../../shared/api/index';
import {
  MachineEffectHttpMethod,
  type SubmitSessionMonitorDecisionRequestDto,
} from '../../shared/api/generated/api';
import type { AssistantCompleteEvent } from '../../run/types';
import type {
  OnCompleteContext,
  OnCompleteDeps,
  PrepareResult,
  PromptTypeHandler,
  PromptTypeHandlerDeps,
} from '../prompt-type-handler';
import type { CreateReportProxy } from '../submission-tools/create-report-proxy';
import { buildSessionMonitorPrompt } from './session-monitor-prompt';
import { parseSessionMonitorDecision } from './session-monitor-response';

const decisionResponseSchema = z
  .object({
    data: z.object({
      evidenceMessageId: z.string().uuid(),
    }),
  })
  .passthrough();

const buildDeferralPayload = (input: {
  targetSessionId: string;
  turnId: string;
  reportIds: string[];
  reasoning: string;
}): SessionMonitorDeferralReportPayload => ({
  summary:
    'Session Monitor left the Agent Session paused for user review. The durable reasoning records why the settled Turn could not be continued safely from its assistant Message, workflow state, and optional Reports.',
  reportType: ReportType.SessionMonitorDeferral,
  assessedSessionId: input.targetSessionId,
  assessedTurnId: input.turnId,
  assessedReportIds: input.reportIds,
  reasoning: input.reasoning,
});

export class SessionMonitorHandler implements PromptTypeHandler<SessionMonitorPromptPayload> {
  public readonly id = 'session_monitor';
  public readonly promptType = LocalPromptType.SessionMonitor;
  public readonly service = 'required';
  public readonly launchEntity = 'required';
  public readonly implementationReadiness = 'none';
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly providerSessionLifetime = 'turn' as const;
  public readonly reports = [];
  public readonly mcpToolUseCase = 'session_monitor' as const;

  public constructor(private readonly createReportProxy: CreateReportProxy) {}

  public prepare(
    run: AgenticSession,
    payload: SessionMonitorPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<SessionMonitorPromptPayload>> {
    const evaluation = deps.sessionMonitorEvaluationStore.requireContext(run.agentic_session_id);
    deps.logger.info('session_monitor.prepare.complete', {
      runId: run.agentic_session_id,
      targetSessionId: evaluation.targetSessionId,
      turnId: evaluation.turnId,
      reportCount: evaluation.reports.length,
      workflowState: evaluation.workflow.state,
      actionCount: evaluation.availableActions.length,
    });
    return Promise.resolve({ payload });
  }

  public buildPrompt(payload: SessionMonitorPromptPayload): string {
    return buildSessionMonitorPrompt(payload);
  }

  public buildStartingMessage(): null {
    return null;
  }

  public async onComplete(
    event: AssistantCompleteEvent,
    ctx: OnCompleteContext,
    deps: OnCompleteDeps,
  ): Promise<void> {
    let evaluation;
    try {
      evaluation = deps.sessionMonitorEvaluationStore.requireContext(ctx.runId);
    } catch (error) {
      deps.logger.error('session_monitor.on_complete.effect_context_missing', {
        runId: ctx.runId,
        error,
      });
      deps.sessionMonitorEvaluationStore.fail(ctx.runId, 'SESSION_MONITOR_EFFECT_CONTEXT_MISSING');
      return;
    }
    const parsed = parseSessionMonitorDecision(event.summary, evaluation.availableActions);
    if (!parsed.ok) {
      deps.logger.error('session_monitor.on_complete.invalid_decision', {
        runId: ctx.runId,
        error: parsed.error,
      });
      deps.sessionMonitorEvaluationStore.fail(ctx.runId, 'SESSION_MONITOR_DECISION_INVALID');
      return;
    }
    const decision = parsed.value;

    try {
      if (decision.disposition === 'DEFER') {
        const result = await this.createReportProxy.create({
          runId: ctx.runId,
          conversationId: evaluation.targetConversationId,
          projectId: ctx.projectId,
          args: {
            reportType: ReportType.SessionMonitorDeferral,
            audience: ReportAudience.ProjectVisible,
            entities: [
              {
                entityType: ReportRelatedEntityType.AgentSession,
                entityId: evaluation.targetSessionId,
                relation: ReportEntityRelation.Primary,
              },
            ],
            payload: buildDeferralPayload({
              targetSessionId: evaluation.targetSessionId,
              turnId: evaluation.turnId,
              reportIds: evaluation.reports.map(({ reportId }) => reportId),
              reasoning: decision.reasoning,
            }),
          },
        });
        deps.logger.info('session_monitor.on_complete.deferral_report.created', {
          runId: ctx.runId,
          targetSessionId: evaluation.targetSessionId,
          turnId: evaluation.turnId,
          deferralReportId: result.reportId,
        });
      }

      const sourceReport = evaluation.reports[0];
      const workflowNodeId = evaluation.workflow.nodeId;
      const pendingTriggerMessageId = evaluation.workflow.triggerMessageId;
      if (!sourceReport) {
        throw new Error('Session Monitor decision requires a source Report.');
      }
      const workflowBinding =
        decision.disposition === 'DEFER'
          ? {}
          : workflowNodeId && pendingTriggerMessageId
            ? { workflowNodeId, pendingTriggerMessageId }
            : (() => {
                throw new Error(
                  'Session Monitor continuation requires an active pending workflow trigger.',
                );
              })();
      const semanticRequest = {
        decisionId: ctx.messageId,
        parentAgentSessionId: evaluation.targetSessionId,
        reportId: sourceReport.reportId,
        conversationId: evaluation.targetConversationId,
        ...workflowBinding,
        content: decision.content,
        decision:
          decision.disposition === 'DEFER'
            ? ({ kind: 'DEFER' } as const)
            : 'action' in decision.continuationCompletion
              ? ({
                  kind: 'ACTION',
                  action: decision.continuationCompletion.action,
                  ...(decision.continuationCompletion.response
                    ? { response: decision.continuationCompletion.response }
                    : {}),
                } as const)
              : ({
                  kind: 'RESPONSE',
                  response: decision.continuationCompletion.response,
                } as const),
      } satisfies Omit<SubmitSessionMonitorDecisionRequestDto, 'proof'>;
      const route =
        `/organizations/${encodeURIComponent(ctx.organizationId)}` +
        `/projects/${encodeURIComponent(ctx.projectId)}` +
        `/agent-sessions/${encodeURIComponent(ctx.runId)}` +
        '/session-monitor-decisions';
      const baseUrl = deps.apiBaseUrl.replace(/\/$/u, '');
      const signed = await deps.machineEffectProofSigner.sign({
        operationId: 'submitSessionMonitorDecision',
        method: MachineEffectHttpMethod.Post,
        path: new URL(`${baseUrl}${route}`).pathname,
        payload: semanticRequest,
        organizationId: ctx.organizationId,
        effectId: ctx.messageId,
      });
      const response = await deps.fetchImpl(`${baseUrl}${route}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${signed.machineCredential}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...semanticRequest, proof: signed.proof }),
      });
      if (!response.ok) {
        throw new Error(
          `Session Monitor decision effect failed with status ${String(response.status)}.`,
        );
      }
      const responseBody: unknown = await response.json();
      const admitted = decisionResponseSchema.parse(responseBody);
      deps.logger.info('session_monitor.on_complete.effect.completed', {
        runId: ctx.runId,
        targetSessionId: evaluation.targetSessionId,
        turnId: evaluation.turnId,
        disposition: decision.disposition,
        evidenceMessageId: admitted.data.evidenceMessageId,
      });
      deps.sessionMonitorEvaluationStore.resolve(ctx.runId, {
        status: 'HANDLED',
        outcome: decision.disposition === 'CONTINUE' ? 'CONTINUED' : 'DEFERRED',
      });
    } catch (error) {
      deps.logger.error('session_monitor.on_complete.effect.failed', {
        runId: ctx.runId,
        targetSessionId: evaluation.targetSessionId,
        turnId: evaluation.turnId,
        disposition: decision.disposition,
        error,
      });
      deps.sessionMonitorEvaluationStore.fail(ctx.runId, 'SESSION_MONITOR_EFFECT_FAILED');
    }
  }
}
