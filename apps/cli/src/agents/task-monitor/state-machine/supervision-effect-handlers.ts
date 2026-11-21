import { z } from 'zod';
import {
  AgentSessionStatus,
  MachineEffectHttpMethod,
  TaskMonitorReviewMode,
  WorkStatus,
  type UpdateAgentSessionDto,
  type TaskMonitorExecutionDefinition,
  type TaskMonitorLaunchConfig,
} from '@hey-hey/contracts/api/models';
import {
  LocalPromptType,
  type LocalTaskMonitorCoordinatorDecision,
} from '@hey-hey/contracts/agent-bridge';
import { buildCodeReviewRequest } from '../../review-subagent/review-request';
import type { TaskMonitorDecisionStore } from '../task-monitor-decision-store';
import {
  toTaskMonitorReviewLifecycleMessage,
  toTaskMonitorSupervisionMessage,
  type TaskMonitorReviewLifecycle,
} from '../task-monitor-decision-message';
import { MachineEffectProofSigner } from '../../../auth/machine-effect-proof';
import type { RunStore } from '../../../run-store';
import type { MessagePoster } from '../../../run/message-poster';
import type { KeyPairStore } from '../../../credentials';
import type { LocalAgentService } from '../../../server/local-agent-service';
import type { ServerLogger } from '../../../server/logger';
import type { AgentSessionReader } from '../../../server/monitors/agent-session-reader';
import { TaskMonitorCoordinatorRunner } from '../../../server/monitors/runner';
import type { PlatformAuth, PlatformAuthContext } from '../../../server/platform-auth-context';
import { TaskMonitorStartRuntime } from '../../../server/task-monitor-start';
import type {
  EffectExecutionIdentity,
  EffectHandler,
  EffectSettlement,
} from '../../../state-machine';
import type {
  DeliverTaskMonitorReviewEffect,
  EvaluateTaskMonitorSettledRunEffect,
} from './effects';
import type { TaskMonitorMachineEffectOutcome } from './events';
import type { TaskMonitorKind } from '../kinds/task-monitor-kind';

const guidanceEffectResponseSchema = z
  .object({ data: z.object({ messageId: z.string().uuid() }).passthrough() })
  .passthrough();

export interface TaskMonitorSettledRunEvaluationEffectHandlerDependencies {
  readonly apiBaseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly authContext: PlatformAuthContext;
  readonly agentSessionReader: AgentSessionReader;
  readonly agentService: LocalAgentService;
  readonly runStore: RunStore;
  readonly messagePoster: MessagePoster;
  readonly keyPairStore: KeyPairStore;
  readonly decisionStore: TaskMonitorDecisionStore;
  readonly taskMonitorStartRuntime: TaskMonitorStartRuntime;
  readonly logger: ServerLogger;
  readonly coordinatorRunner: TaskMonitorCoordinatorRunner;
}

interface TaskMonitorCoordinationDecisionEffect {
  readonly type: 'TASK_MONITOR_COORDINATION_DECISION';
  readonly taskMonitorId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly kindKey: string | null;
  readonly authorityCommandId?: string | undefined;
  readonly runId: string;
  readonly agentSessionId: string;
  readonly promptType: string | null;
  readonly terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED' | null;
  readonly reviewRequestId: string | null;
}

type TaskMonitorSupervisionEffect =
  | EvaluateTaskMonitorSettledRunEffect
  | TaskMonitorCoordinationDecisionEffect;

/** Owns the canonical provider and platform calls made by settled-Run supervision. */
class TaskMonitorSupervisionOwners {
  private readonly baseUrl: string;

  public constructor(
    private readonly dependencies: TaskMonitorSettledRunEvaluationEffectHandlerDependencies,
  ) {
    this.baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
  }

  /** The kind the monitor recorded, resolved from its project's effective definition. */
  public kindFor(effect: TaskMonitorSupervisionEffect): Promise<TaskMonitorKind> {
    return this.dependencies.taskMonitorStartRuntime.kindFor({
      organizationId: effect.organizationId,
      projectId: effect.projectId,
      taskMonitorId: effect.taskMonitorId,
      kindKey: effect.kindKey,
    });
  }

  public async completeAgentSession(auth: PlatformAuth, agentSessionId: string): Promise<void> {
    const machineId = await this.dependencies.keyPairStore.loadCurrentMachineId();
    if (!machineId) {
      throw new Error('Cannot complete the Agent Session without the current machine identity.');
    }
    const update = {
      machineId,
      status: AgentSessionStatus.Completed,
    } satisfies UpdateAgentSessionDto;
    await this.patch(auth, `/agent-sessions/${encodeURIComponent(agentSessionId)}`, update);
  }

  public requestReview(agentSessionId: string, rationale: string): Promise<void> {
    return this.dependencies.agentService
      .sendSystemMessage(agentSessionId, buildCodeReviewRequest(rationale))
      .then(() => undefined);
  }

  public async publishReviewLifecycle(
    auth: PlatformAuth,
    coordinatorRunId: string,
    lifecycle: TaskMonitorReviewLifecycle,
  ): Promise<void> {
    const run = await this.dependencies.runStore.getRun(coordinatorRunId);
    if (!run) throw new Error('Task Monitor coordinator Run is unavailable for publication.');
    await this.dependencies.messagePoster.createOutOfBand({
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      conversationId: run.conversationId,
      dto: toTaskMonitorReviewLifecycleMessage(auth.projectId, lifecycle),
      stamp: {
        providerSessionId: run.provider_session_id ?? null,
        promptHandler: LocalPromptType.TaskMonitor,
      },
    });
  }

  public async sendGuidance(
    auth: PlatformAuth,
    effect: Pick<
      TaskMonitorSupervisionEffect,
      'taskMonitorId' | 'agentSessionId' | 'authorityCommandId'
    >,
    conversationId: string,
    guidance: string,
    effectId: string,
  ): Promise<string> {
    const machineId = await this.dependencies.keyPairStore.loadCurrentMachineId();
    if (!machineId) {
      throw new Error('Task Monitor guidance requires the current paired machine.');
    }
    if (!effect.authorityCommandId) {
      throw new Error('Task Monitor guidance is missing its admitted START command identity.');
    }
    const route =
      `/organizations/${encodeURIComponent(auth.organizationId)}` +
      `/projects/${encodeURIComponent(auth.projectId)}` +
      `/machines/${encodeURIComponent(machineId)}` +
      `/task-monitors/${encodeURIComponent(effect.taskMonitorId)}` +
      `/commands/${encodeURIComponent(effect.authorityCommandId)}` +
      `/agent-sessions/${encodeURIComponent(effect.agentSessionId)}` +
      `/conversations/${encodeURIComponent(conversationId)}/guidance-effects`;
    const payload = { guidance } as const;
    const signed = await new MachineEffectProofSigner(this.dependencies.keyPairStore).sign({
      operationId: 'submitTaskMonitorGuidanceEffect',
      method: MachineEffectHttpMethod.Post,
      path: new URL(`${this.baseUrl}${route}`).pathname,
      payload,
      organizationId: auth.organizationId,
      effectId,
    });
    const response = await this.dependencies.fetchImpl(`${this.baseUrl}${route}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${signed.machineCredential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...payload, proof: signed.proof }),
    });
    if (!response.ok) {
      throw new Error(
        `Task Monitor guidance effect failed with status ${String(response.status)}.`,
      );
    }
    const responseBody: unknown = await response.json();
    return guidanceEffectResponseSchema.parse(responseBody).data.messageId;
  }

  public async publishDecision(
    auth: PlatformAuth,
    coordinatorRunId: string,
    decision: LocalTaskMonitorCoordinatorDecision,
  ): Promise<string> {
    const run = await this.dependencies.runStore.getRun(coordinatorRunId);
    if (!run) throw new Error('Task Monitor coordinator Run is unavailable for publication.');
    return this.dependencies.messagePoster.createOutOfBand({
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      conversationId: run.conversationId,
      dto: toTaskMonitorSupervisionMessage(auth.projectId, decision),
      stamp: {
        providerSessionId: run.provider_session_id ?? null,
        promptHandler: LocalPromptType.TaskMonitor,
      },
    });
  }

  public async halt(
    effect: Pick<TaskMonitorSupervisionEffect, 'taskMonitorId' | 'agentSessionId'>,
    auth: PlatformAuth,
    failureContext: string,
  ): Promise<void> {
    await this.dependencies.taskMonitorStartRuntime.haltMonitor({
      monitorId: effect.taskMonitorId,
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      failureContext,
    });
    const runId = this.dependencies.runStore.lookupByAgentSessionId(effect.agentSessionId);
    if (runId !== null) await this.dependencies.agentService.stopRun(runId);
  }

  private urlFor(auth: PlatformAuth, resourcePath: string): string {
    return (
      `${this.baseUrl}/organizations/${encodeURIComponent(auth.organizationId)}` +
      `/projects/${encodeURIComponent(auth.projectId)}${resourcePath}`
    );
  }

  private async patch(auth: PlatformAuth, resourcePath: string, body: object): Promise<void> {
    const response = await this.dependencies.fetchImpl(this.urlFor(auth, resourcePath), {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 500);
      throw new Error(
        `Task Monitor supervision mutation failed (${String(response.status)}): ${responseBody}`,
      );
    }
  }
}

/** Owns delivery and stable-identity recovery for one committed Review request. */
export class TaskMonitorReviewDeliveryEffectHandler implements EffectHandler<
  DeliverTaskMonitorReviewEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: (effect: DeliverTaskMonitorReviewEffect) => this.reconcile(effect),
  };

  private readonly owners: TaskMonitorSupervisionOwners;

  public constructor(
    private readonly dependencies: TaskMonitorSettledRunEvaluationEffectHandlerDependencies,
  ) {
    this.owners = new TaskMonitorSupervisionOwners(dependencies);
  }

  public async execute(
    effect: DeliverTaskMonitorReviewEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    this.dependencies.logger.info('task_monitor.review_delivery.started', {
      taskMonitorId: effect.taskMonitorId,
      requestId: effect.requestId,
      agentSessionId: effect.agentSessionId,
      effectId: execution.effectId,
    });
    const auth = await this.requireAuth(effect);
    if (auth === null)
      return this.failed(effect, 'Review delivery owner scope is unavailable.', true);
    try {
      const existing = await this.dependencies.runStore.getRun(effect.agentSessionId);
      if (existing?.promptType === LocalPromptType.CodeReview) {
        this.dependencies.logger.info('task_monitor.review_delivery.duplicate_prevented', {
          taskMonitorId: effect.taskMonitorId,
          requestId: effect.requestId,
        });
        await this.publish(auth, effect, 'AWAITING_REVIEW');
        return this.accepted(effect);
      }
      await this.publish(auth, effect, 'REQUESTING_REVIEW');
      await this.owners.requestReview(effect.agentSessionId, effect.rationale);
      await this.publish(auth, effect, 'AWAITING_REVIEW');
      this.dependencies.logger.info('task_monitor.review_delivery.accepted', {
        taskMonitorId: effect.taskMonitorId,
        requestId: effect.requestId,
      });
      return this.accepted(effect);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Review request delivery failed.';
      this.dependencies.logger.error('task_monitor.review_delivery.failed', {
        taskMonitorId: effect.taskMonitorId,
        requestId: effect.requestId,
        reason,
      });
      await this.publishFailure(auth, effect, reason, false);
      return this.failed(effect, reason, false);
    }
  }

  private async reconcile(
    effect: DeliverTaskMonitorReviewEffect,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const auth = await this.requireAuth(effect);
    if (auth === null)
      return this.failed(effect, 'Review recovery owner scope is unavailable.', true);
    const recoveryContext =
      'A claimed Review request is being reconciled against the target coding session before retry.';
    await this.owners.publishReviewLifecycle(auth, effect.coordinatorRunId, {
      outcome: 'REVIEW_REQUEST_RECONCILING',
      requestId: effect.requestId,
      rationale: effect.rationale,
      recoveryContext,
    });
    const current = await this.dependencies.runStore.getRun(effect.agentSessionId);
    if (current?.promptType === LocalPromptType.CodeReview) {
      await this.publish(auth, effect, 'AWAITING_REVIEW');
      return this.accepted(effect);
    }
    if (current) {
      try {
        await this.owners.requestReview(effect.agentSessionId, effect.rationale);
        await this.publish(auth, effect, 'AWAITING_REVIEW');
        return this.accepted(effect);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Review request retry failed.';
        await this.publishFailure(auth, effect, reason, false);
        return this.failed(effect, reason, false);
      }
    }
    const reason = 'The claimed Review request cannot be reconciled to its target coding session.';
    await this.publishFailure(auth, effect, reason, true);
    return this.failed(effect, reason, true);
  }

  private async requireAuth(effect: DeliverTaskMonitorReviewEffect): Promise<PlatformAuth | null> {
    const auth = await this.dependencies.authContext.resolve(effect.projectId);
    return auth?.organizationId === effect.organizationId && auth.projectId === effect.projectId
      ? auth
      : null;
  }

  private publish(
    auth: PlatformAuth,
    effect: DeliverTaskMonitorReviewEffect,
    outcome: 'REQUESTING_REVIEW' | 'AWAITING_REVIEW',
  ): Promise<void> {
    return this.owners.publishReviewLifecycle(auth, effect.coordinatorRunId, {
      outcome,
      requestId: effect.requestId,
      rationale: effect.rationale,
    });
  }

  private async publishFailure(
    auth: PlatformAuth,
    effect: DeliverTaskMonitorReviewEffect,
    reason: string,
    ambiguous: boolean,
  ): Promise<void> {
    await this.owners.publishReviewLifecycle(
      auth,
      effect.coordinatorRunId,
      ambiguous
        ? {
            outcome: 'REVIEW_RECOVERY_JUDGMENT_REQUIRED',
            requestId: effect.requestId,
            rationale: effect.rationale,
            recoveryContext: reason,
          }
        : {
            outcome: 'REVIEW_REQUEST_FAILED',
            requestId: effect.requestId,
            rationale: effect.rationale,
            failureContext: reason,
          },
    );
  }

  private accepted(
    effect: DeliverTaskMonitorReviewEffect,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return {
      status: 'succeeded',
      outcome: {
        type: 'REVIEW_REQUEST_ACCEPTED',
        taskMonitorId: effect.taskMonitorId,
        runId: effect.runId,
        agentSessionId: effect.agentSessionId,
        requestId: effect.requestId,
      },
    };
  }

  private failed(
    effect: DeliverTaskMonitorReviewEffect,
    reason: string,
    ambiguous: boolean,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return {
      status: ambiguous ? 'uncertain' : 'failed',
      outcome: {
        type: 'REVIEW_REQUEST_FAILED',
        taskMonitorId: effect.taskMonitorId,
        runId: effect.runId,
        agentSessionId: effect.agentSessionId,
        requestId: effect.requestId,
        reason,
        ambiguous,
      },
    };
  }
}

const launchConfigFor = (
  entry: TaskMonitorExecutionDefinition['executionPlan'][number],
  worktree: TaskMonitorLaunchConfig['worktree'],
): TaskMonitorLaunchConfig => ({
  taskId: entry.taskId,
  method: entry.launchConfiguration.method,
  provider: entry.launchConfiguration.provider,
  model: entry.launchConfiguration.model,
  reasoningEffort: entry.launchConfiguration.reasoningEffort,
  ...(entry.launchConfiguration.fastMode === undefined
    ? {}
    : { fastMode: entry.launchConfiguration.fastMode }),
  ...(worktree ? { worktree } : {}),
});

const acceptsTaskUnderReviewPolicy = (
  mode: TaskMonitorReviewMode,
  effect: Pick<TaskMonitorSupervisionEffect, 'promptType' | 'terminalOutcome' | 'reviewRequestId'>,
): boolean =>
  mode === TaskMonitorReviewMode.AgentDecides ||
  (effect.reviewRequestId !== null &&
    effect.promptType === LocalPromptType.CodeReview &&
    effect.terminalOutcome === 'COMPLETED');

/** Executes one already-committed settled-Run evaluation and emits one typed result. */
export class TaskMonitorSettledRunEvaluationEffectHandler implements EffectHandler<
  EvaluateTaskMonitorSettledRunEffect,
  TaskMonitorMachineEffectOutcome
> {
  public readonly recovery = {
    strategy: 'reconcile' as const,
    reconcile: async (
      effect: EvaluateTaskMonitorSettledRunEffect,
      execution: EffectExecutionIdentity,
    ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> => {
      const prior = await this.coordinator.reconcileRejectedAttempt(
        effect.taskMonitorId,
        effect.projectId,
        execution.effectId,
      );
      if (prior)
        return {
          status: 'succeeded',
          outcome: {
            type: 'COORDINATOR_DECISION_INVALID',
            taskMonitorId: effect.taskMonitorId,
            runId: effect.runId,
            agentSessionId: effect.agentSessionId,
            attemptId: execution.effectId,
            evaluation: effect,
            failure: { ...prior.error, issues: [...(prior.error.issues ?? [])] },
          },
        };
      return {
        status: 'uncertain',
        outcome: this.supervisionFailed(
          effect,
          'Settled-Run supervision was interrupted after its durable effect was claimed.',
        ),
      };
    },
  };

  private readonly coordinator: TaskMonitorCoordinatorRunner;
  private readonly owners: TaskMonitorSupervisionOwners;

  public constructor(
    private readonly dependencies: TaskMonitorSettledRunEvaluationEffectHandlerDependencies,
  ) {
    this.coordinator = dependencies.coordinatorRunner;
    this.owners = new TaskMonitorSupervisionOwners(dependencies);
  }

  public async execute(
    effect: EvaluateTaskMonitorSettledRunEffect,
    execution: EffectExecutionIdentity,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const logContext = {
      taskMonitorId: effect.taskMonitorId,
      runId: effect.runId,
      agentSessionId: effect.agentSessionId,
      turnId: effect.turnId,
      effectId: execution.effectId,
    };
    this.dependencies.logger.info('task_monitor.supervision.effect.started', logContext);
    try {
      const auth = await this.dependencies.authContext.resolve(effect.projectId);
      if (
        auth === null ||
        auth.organizationId !== effect.organizationId ||
        auth.projectId !== effect.projectId
      ) {
        return this.failed(effect, 'Task Monitor supervision owner scope is unavailable or stale.');
      }

      const monitor = await this.dependencies.taskMonitorStartRuntime.readMonitor({
        monitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
      });
      const executionIndex = monitor.definition.cursor;
      const entry = monitor.definition.executionPlan[executionIndex];
      const session = await this.dependencies.agentSessionReader.readAgentSession(
        effect.agentSessionId,
        effect.projectId,
      );
      if (
        monitor.status !== WorkStatus.Active ||
        entry?.agentSessionId !== effect.agentSessionId ||
        !session?.conversationId ||
        session.config?.type !== 'CODING_SESSION' ||
        session.config.version !== 'v2' ||
        session.config.taskMonitorId !== effect.taskMonitorId
      ) {
        return this.failed(
          effect,
          'Settled-Run supervision no longer matches canonical ownership.',
        );
      }

      const kind = await this.owners.kindFor(effect);
      if (kind.supervision === 'DIRECT_ACCEPTANCE') {
        return await this.superviseDirectly(effect, auth, entry.taskId, kind);
      }

      await kind.retainOperationResult(
        {
          organizationId: effect.organizationId,
          projectId: effect.projectId,
          nodeId: entry.taskId,
          agentSessionId: effect.agentSessionId,
          turnReportIds: effect.reports.map((report) => report.reportId),
        },
        effect.turnId,
        effect.promptType === 'code_review',
      );

      const completedAssistantMessage = effect.completedAssistantMessageId
        ? await this.dependencies.agentService.readAssistantMessage({
            organizationId: auth.organizationId,
            projectId: auth.projectId,
            conversationId: session.conversationId,
            messageId: effect.completedAssistantMessageId,
          })
        : null;
      if (effect.completedAssistantMessageId && !completedAssistantMessage) {
        return this.failed(effect, 'Completed assistant Message could not be resolved.');
      }

      const launchConfig = launchConfigFor(entry, monitor.definition.launchPolicy.worktree);
      const judgment = effect.judgment;
      const evaluation = await this.coordinator.runTaskMonitor(
        {
          monitorId: effect.taskMonitorId,
          cause: judgment ? 'JUDGMENT_RESOLVED' : 'CONTINUE',
          correlationId: judgment?.requestMessageId ?? effect.turnId,
          coordinatorAttemptId: execution.effectId,
          ...(effect.correction ? { correction: effect.correction } : {}),
          launchConfig,
          settledTurn: {
            turnId: effect.turnId,
            promptType: effect.promptType,
            terminalOutcome: effect.terminalOutcome,
            completedAssistantMessage,
            reports: effect.reports.map(({ reportId, reportType }) => ({ reportId, reportType })),
          },
          ...(judgment ? { judgment } : {}),
        },
        auth,
      );
      if (!evaluation) {
        return this.failed(effect, 'Task Monitor coordinator Run could not be started.');
      }
      const result = await this.dependencies.decisionStore.wait(evaluation.runId);
      if (result.status === 'INVALID') {
        return {
          status: 'succeeded',
          outcome: {
            type: 'COORDINATOR_DECISION_INVALID',
            taskMonitorId: effect.taskMonitorId,
            runId: effect.runId,
            agentSessionId: effect.agentSessionId,
            attemptId: execution.effectId,
            evaluation: effect,
            failure: result.failure ?? {
              code: 'INVALID_DECISION',
              message: result.reason,
              issues: [],
            },
          },
        };
      }
      if (result.status !== 'DECISION') {
        const reason = `Task Monitor coordinator settled without a decision (${result.terminalOutcome}).`;
        return this.failed(effect, reason);
      }

      const current = await this.dependencies.taskMonitorStartRuntime.readMonitor({
        monitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
      });
      const currentEntry = current.definition.executionPlan[current.definition.cursor];
      if (
        current.status !== WorkStatus.Active ||
        current.definition.cursor !== executionIndex ||
        currentEntry?.taskId !== entry.taskId ||
        currentEntry.agentSessionId !== effect.agentSessionId
      ) {
        return this.failed(
          effect,
          'Task Monitor changed while settled-Run supervision was active.',
        );
      }

      return await this.applyDecision(
        effect,
        execution,
        auth,
        evaluation.runId,
        launchConfig,
        entry.taskId,
        session.conversationId,
        current.definition.launchPolicy.terminalSupervision.mode,
        result.decision,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Task Monitor supervision failed.';
      this.dependencies.logger.error('task_monitor.supervision.effect.failed', {
        ...logContext,
        reason,
      });
      return this.failed(effect, reason);
    }
  }

  public applyDecisionForCoordination(
    effect: TaskMonitorCoordinationDecisionEffect,
    decision: LocalTaskMonitorCoordinatorDecision,
    coordinatorRunId: string,
    execution: EffectExecutionIdentity,
    auth: PlatformAuth,
    taskId: string,
    conversationId: string | null,
    reviewMode: TaskMonitorReviewMode,
    completeAgentSession: boolean,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    return this.applyDecision(
      effect,
      execution,
      auth,
      coordinatorRunId,
      undefined,
      taskId,
      conversationId,
      reviewMode,
      decision,
      completeAgentSession,
    );
  }

  private async applyDecision(
    effect: TaskMonitorSupervisionEffect,
    execution: EffectExecutionIdentity,
    auth: PlatformAuth,
    coordinatorRunId: string,
    launchConfig: TaskMonitorLaunchConfig | undefined,
    taskId: string,
    conversationId: string | null,
    reviewMode: TaskMonitorReviewMode,
    decision: LocalTaskMonitorCoordinatorDecision,
    completeAgentSession = true,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    switch (decision.action) {
      case 'APPROVE_PERMISSION':
      case 'DENY_PERMISSION':
      case 'ESCALATE_PERMISSION':
        throw new Error(`${decision.action} decides a permission request, not a settled Run.`);
      case 'REQUEST_REVIEW':
        if (
          effect.terminalOutcome === 'COMPLETED' &&
          effect.promptType !== LocalPromptType.CodeReview
        ) {
          if (
            reviewMode === TaskMonitorReviewMode.RequireReview ||
            reviewMode === TaskMonitorReviewMode.AgentDecides
          ) {
            return {
              status: 'succeeded',
              outcome: {
                type: 'REVIEW_REQUEST_COMMITTED',
                taskMonitorId: effect.taskMonitorId,
                runId: effect.runId,
                agentSessionId: effect.agentSessionId,
                requestId: coordinatorRunId,
                coordinatorRunId,
                rationale: decision.rationale,
              },
            };
          }
        }
        return this.failed(effect, 'Review request does not match terminal supervision policy.');
      case 'REQUEST_CHANGES':
        if (!conversationId) {
          return this.failed(effect, 'Changes guidance requires a canonical conversation.');
        }
        await this.owners.sendGuidance(
          auth,
          effect,
          conversationId,
          decision.guidance,
          execution.effectId,
        );
        await this.owners.publishDecision(auth, coordinatorRunId, decision);
        return this.continues(effect);
      case 'WAIT':
        await this.owners.publishDecision(auth, coordinatorRunId, decision);
        return this.continues(effect);
      case 'REQUEST_JUDGMENT': {
        const requestMessageId = await this.owners.publishDecision(
          auth,
          coordinatorRunId,
          decision,
        );
        return {
          status: 'succeeded',
          outcome: this.judgment(effect, decision.guidance, requestMessageId),
        };
      }
      case 'HALT':
        await this.owners.halt(effect, auth, decision.failureContext);
        await this.owners.publishDecision(auth, coordinatorRunId, decision);
        return {
          status: 'succeeded',
          outcome: {
            type: 'SUPERVISION_HALTED',
            taskMonitorId: effect.taskMonitorId,
            runId: effect.runId,
            agentSessionId: effect.agentSessionId,
            reason: decision.failureContext,
          },
        };
      case 'ACCEPT_TASK': {
        if (!acceptsTaskUnderReviewPolicy(reviewMode, effect)) {
          return this.failed(
            effect,
            'Task acceptance requires a successful Review bound to the current selected work.',
          );
        }
        const kind = await this.owners.kindFor(effect);
        await kind.admitOperation(
          auth,
          { nodeId: taskId, agentSessionId: effect.agentSessionId },
          coordinatorRunId,
        );
        return this.settleAcceptedNode(effect, auth, kind, taskId, completeAgentSession, () =>
          this.owners.publishDecision(auth, coordinatorRunId, decision),
        );
      }
    }
  }

  /**
   * Direct acceptance: the node's durable normalized result settles it and no coordinator run
   * starts. A failed or unavailable result halts the monitor with its reason.
   */
  private async superviseDirectly(
    effect: EvaluateTaskMonitorSettledRunEffect,
    auth: PlatformAuth,
    nodeId: string,
    kind: TaskMonitorKind,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const verdict = await kind.judgeSettled({
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      nodeId,
      agentSessionId: effect.agentSessionId,
      turnReportIds: effect.reports.map((report) => report.reportId),
    });
    if (!verdict.accept) {
      this.dependencies.logger.error('task_monitor.supervision.direct.failed', {
        taskMonitorId: effect.taskMonitorId,
        runId: effect.runId,
        agentSessionId: effect.agentSessionId,
        turnId: effect.turnId,
        kind: kind.key,
        nodeId,
        reason: verdict.reason,
      });
      await this.owners.halt(effect, auth, verdict.reason);
      return {
        status: 'succeeded',
        outcome: {
          type: 'SUPERVISION_HALTED',
          taskMonitorId: effect.taskMonitorId,
          runId: effect.runId,
          agentSessionId: effect.agentSessionId,
          reason: verdict.reason,
        },
      };
    }

    this.dependencies.logger.info('task_monitor.supervision.direct.accepted', {
      taskMonitorId: effect.taskMonitorId,
      runId: effect.runId,
      turnId: effect.turnId,
      kind: kind.key,
      nodeId,
    });
    return this.settleAcceptedNode(effect, auth, kind, nodeId, true, null);
  }

  /** Accepts the node through its kind, then completes the monitor or continues to the next node. */
  private async settleAcceptedNode(
    effect: TaskMonitorSupervisionEffect,
    auth: PlatformAuth,
    kind: TaskMonitorKind,
    nodeId: string,
    completeAgentSession: boolean,
    publishDecision: (() => Promise<unknown>) | null,
  ): Promise<EffectSettlement<TaskMonitorMachineEffectOutcome>> {
    const acceptance = await kind.acceptSettled(
      auth,
      { nodeId, agentSessionId: effect.agentSessionId },
      completeAgentSession
        ? () => this.owners.completeAgentSession(auth, effect.agentSessionId)
        : null,
    );
    if (!acceptance.accepted) {
      return this.failed(effect, acceptance.reason);
    }
    const latestMonitor = await this.dependencies.taskMonitorStartRuntime.readMonitor({
      monitorId: effect.taskMonitorId,
      organizationId: effect.organizationId,
      projectId: effect.projectId,
    });
    const remaining = latestMonitor.definition.executionPlan.slice(
      latestMonitor.definition.cursor + 1,
    );
    const remainingDone = await Promise.all(
      remaining.map((entry) =>
        kind.readDone(auth, { nodeId: entry.taskId, agentSessionId: entry.agentSessionId ?? null }),
      ),
    );
    const allDone = remainingDone.every(Boolean);
    if (allDone) {
      await this.dependencies.taskMonitorStartRuntime.completeMonitor({
        monitorId: effect.taskMonitorId,
        organizationId: effect.organizationId,
        projectId: effect.projectId,
      });
    }
    await publishDecision?.();
    return {
      status: 'succeeded',
      outcome: {
        type: allDone ? 'SUPERVISION_COMPLETED' : 'COORDINATION_CONTINUES',
        taskMonitorId: effect.taskMonitorId,
        runId: effect.runId,
        agentSessionId: effect.agentSessionId,
      },
    };
  }

  private continues(
    effect: Pick<TaskMonitorSupervisionEffect, 'taskMonitorId' | 'runId' | 'agentSessionId'>,
    nextAgentSessionId?: string,
    nextConversationId?: string,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return {
      status: 'succeeded',
      outcome: {
        type: 'SUPERVISION_CONTINUES_OBSERVING',
        taskMonitorId: effect.taskMonitorId,
        runId: effect.runId,
        agentSessionId: effect.agentSessionId,
        ...(nextAgentSessionId ? { nextAgentSessionId } : {}),
        ...(nextConversationId ? { nextConversationId } : {}),
      },
    };
  }

  private failed(
    effect: TaskMonitorSupervisionEffect,
    reason: string,
  ): EffectSettlement<TaskMonitorMachineEffectOutcome> {
    return { status: 'failed', outcome: this.supervisionFailed(effect, reason) };
  }

  private supervisionFailed(
    effect: TaskMonitorSupervisionEffect,
    reason: string,
  ): Extract<TaskMonitorMachineEffectOutcome, { type: 'SUPERVISION_FAILED' }> {
    return {
      type: 'SUPERVISION_FAILED',
      taskMonitorId: effect.taskMonitorId,
      runId: effect.runId,
      agentSessionId: effect.agentSessionId,
      reason,
    };
  }

  private judgment(
    effect: TaskMonitorSupervisionEffect,
    reason: string,
    requestMessageId: string,
  ): Extract<TaskMonitorMachineEffectOutcome, { type: 'OUTCOME_JUDGMENT_REQUIRED' }> {
    return {
      type: 'OUTCOME_JUDGMENT_REQUIRED',
      taskMonitorId: effect.taskMonitorId,
      runId: effect.runId,
      agentSessionId: effect.agentSessionId,
      reason,
      requestMessageId,
    };
  }
}
