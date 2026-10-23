import { PlanDependenciesService } from '../../../services/plan/plan-dependencies.service';
import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ExtendedUIFieldType,
  PlanGenerationFinalizePayload,
  UIElement,
} from 'src/generated';
import { TaskService } from 'src/services/tasks/task.service';
import { TaskId, ProjectId } from 'src/types';
import { WorkStatus } from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, PlanId, UserId } from 'src/types';
import {
  NodeResult,
  NodeType,
  PlanFromDesignDocFlowContext,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';

/**
 * Terminal `finalize` QUESTIONS node.
 *
 * Entered from `execution-guidance-wait` once the first stage's
 * execution guidance has reached `READY`. By this point the plan-shaping
 * work is complete: the plan was already flipped to `ACTIVE` and its
 * stages/steps materialized upstream. This node's only job is to flip
 * the plan `ACTIVE` (idempotent — it may already be) and render the
 * `PlanGenerationFinalize` UI element so the client can reload the
 * landed plan in place without a manual refresh.
 *
 * This is NOT an EXTERNAL_AGENT node. An earlier revision modeled it as
 * one and self-looped on the agent's `DONE` completion to "keep
 * currentNodeId non-null" — but every entry into an EXTERNAL_AGENT node
 * re-emits its `triggersAgent` envelope (see
 * NodeExecutionService.startExternalAgentNode), so `DONE → FINALIZE`
 * re-dispatched the agent on every cycle, producing an unbounded loop of
 * chatty "the plan is ready" turns. There is no agent work to do here, so
 * there is no agent. Modeling it as a QUESTIONS node parks the flow on
 * the rendered element (the natural WAITING_FOR_USER_INPUT state every
 * interactive node uses after emitting) with no re-dispatch.
 *
 * `acceptsUserMessages = false`: the only meaningful interaction is the
 * client-side reload affordance on the UI element. Free-text user
 * messages here have no effect, so message-processor drops them rather
 * than re-signaling the workflow. The flow simply goes idle and
 * auto-pauses on the user-response timeout.
 *
 * The element must ride a QUESTIONS result specifically:
 * `convertNodeResultToSystemMessage` only carries `uiElements` through
 * for a fixed set of response types, and a `finalize`-typed result
 * (→ `Noop`) is not one of them — its UI element would be silently
 * dropped.
 */
@Injectable()
export class PlanShapingFinalizeNode extends QuestionsNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.FINALIZE;
  readonly title = 'Plan Shaping — Finalize';

  // Only the client-side reload button matters here; suppress free-text
  // re-signals so the terminal node parks cleanly instead of re-running.
  readonly acceptsUserMessages = false;

  private readonly logger = new Logger(PlanShapingFinalizeNode.name);

  constructor(
    private readonly planDependencies: PlanDependenciesService,
    private readonly taskService: TaskService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();

    this.logger.debug('Plan-shaping finalize node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
    });

    const planId = context.core.workflowAboutId as PlanId;
    const organizationId = context.core.organizationId as OrganizationId;
    const authorId = context.core.user.id as UserId;

    let checkpoint = 'load_canonical_plan';
    try {
      const canonicalPlan = await this.prisma.db.task.findFirst({
        where: {
          id: planId,
          organizationId,
          projectId: context.core.projectId,
          type: 'PLAN',
          archivedAt: null,
        },
        select: {
          status: true,
          subTasks: {
            where: { type: 'PLAN_STAGE', archivedAt: null },
            select: { id: true },
          },
        },
      });
      this.logger.debug('Finalize canonical plan loaded', {
        planId,
        found: Boolean(canonicalPlan),
        status: canonicalPlan?.status,
        stageCount: canonicalPlan?.subTasks.length,
      });
      if (!canonicalPlan) throw new Error(`Plan work item ${planId} not found`);
      if (canonicalPlan.status !== 'ACTIVE') {
        this.logger.log('Flipping plan to ACTIVE on finalize entry', {
          planId,
          previousStatus: canonicalPlan.status,
          conversationId: context.core.conversationId,
        });
        checkpoint = 'activate_plan';
        await this.taskService.update(
          organizationId,
          null,
          planId as string as TaskId,
          { status: WorkStatus.Active },
          authorId,
        );
      } else {
        this.logger.debug(
          'Plan already ACTIVE on finalize entry; skipping status flip',
          { planId, conversationId: context.core.conversationId },
        );
      }

      checkpoint = 'resolve_stage_dependencies';
      const stageIds: string[] = canonicalPlan.subTasks.map(
        (stage) => stage.id,
      );
      const stageDependencies = (
        await this.planDependencies.outgoing(
          organizationId,
          context.core.projectId,
          stageIds,
        )
      ).filter((edge) => stageIds.includes(edge.targetNodeId));
      for (const edge of stageDependencies) {
        this.logger.debug('Finalize stage dependency', {
          planId,
          sourceStageId: edge.sourceNodeId,
          targetStageId: edge.targetNodeId,
        });
      }
      const dependentStageIds = new Set(
        stageDependencies.map((dependency) => dependency.sourceNodeId),
      );
      const roots = stageIds.filter(
        (stageId) => !dependentStageIds.has(stageId),
      );
      this.logger.debug('Finalize stage roots resolved', {
        planId,
        stageCount: stageIds.length,
        dependencyCount: stageDependencies.length,
        rootCount: roots.length,
      });
      for (const stageId of stageIds) {
        this.logger.debug('Finalize stage topology', {
          planId,
          stageId,
          isRoot: roots.includes(stageId),
        });
      }
      if (roots.length !== 1) {
        throw new Error(
          `Cannot finalize plan ${planId}: expected one dependency-chain root Stage, found ${roots.length}.`,
        );
      }
      const firstStageId = roots[0] as TaskId;

      checkpoint = 'build_finalize_ui';
      const result = this.finalizeResult(planId, firstStageId);
      this.logger.log('Plan finalization result ready', {
        planId,
        firstStageId,
        conversationId: context.core.conversationId,
      });
      return result;
    } catch (error) {
      this.logger.error('Plan finalization failed', {
        planId,
        conversationId: context.core.conversationId,
        checkpoint,
        includeErrorDetails: true,
        error,
      });
      throw error;
    }
  }

  private finalizeResult(planId: PlanId, firstStageId: TaskId): NodeResult {
    const finalizePayload: PlanGenerationFinalizePayload = {
      responseType:
        PlanGenerationFinalizePayload.ResponseTypeEnum.PlanGenerationFinalizeV1,
      planId,
      firstStageId,
      readyButtonLabel: 'Ready',
      progressLabel: 'Finalizing your plan...',
    };

    this.logger.debug('Emitting plan_generation_finalize UI element', {
      planId,
      firstStageId,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.PlanGenerationFinalize,
        label: 'Plan Shaping — Finalize',
        required: false,
        influences: [],
        payload: finalizePayload,
      },
    ];

    return {
      type: NodeType.QUESTIONS,
      message: '',
      uiElements,
      data: {
        detectedIntent: 'plan_shaping_finalize_started',
        intentConfidence: 1,
      },
    };
  }
}
