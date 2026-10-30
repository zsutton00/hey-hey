import { PrismaService } from 'src/prisma/prisma.service';
import {
  codingPlanMessagesQuery,
  resolveReviewedCodingPlan,
} from './coding-plan-context';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  ExtendedUIFieldType,
  WorkflowReviewAction,
  LocalStartupSessionPromptPayload,
  UIElement,
} from 'src/generated';
import { LocalPromptType } from 'src/generated/local';
import { TaskService } from 'src/services/tasks/task.service';
import {
  ExternalAgentActionSchemas,
  ExternalAgentFlowData,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FeatureSyncFlowContext,
  FlowUserMessage,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { FEATURE_SYNC_NODES } from '../../constants/node-ids';
import { featureSyncCodingPlanActions } from './schemas';
import {
  CodingPlanApprovalPayloadSchema,
  CodingPlanReviewAnswerPayloadSchema,
} from 'src/generated/workflow-review.schemas';

/**
 * Coding-plan gate of the feature-sync flow.
 *
 * Entered from `analyze.NO_DISCREPANCY` or `iterate.RESOLVED`. Emits a
 * SYSTEM trigger message on entry (`data.triggersAgent.promptType =
 * startup_session`) carrying a `LocalStartupSessionPromptPayload`. The
 * payload carries no copy of the task: the CLI loads the focal work item
 * from the persisted Run entity reference, so the task's type is never
 * written into a closed wire enum.
 *
 * The node is an EXTERNAL_AGENT node that accepts two user-authored actions:
 *
 * - `REFINE` — the user requested another planning turn. The flow self-loops
 *   without parking so the node emits a new `startup_session` trigger. The
 *   user's review comments are rendered onto
 *   `codingPlanPendingReviewFeedback` and the next trigger carries them as
 *   the payload's `userMessage`, so the planner receives them as turn input.
 * - `APPROVED` — the user has accepted the
 *   plan currently in the conversation tail. Routes to the terminal
 *   `implement` EXTERNAL_AGENT node so the conversation continues to carry
 *   a non-null `currentNodeId` while the CLI takes over execution.
 * Unlike `iterate`, this node does not duplicate plan state onto
 * `FeatureSyncFlowContext`; the plan lives only in conversation history.
 */
@Injectable()
export class FeatureSyncCodingPlanNode extends ExternalAgentNodeBase<FeatureSyncFlowContext> {
  readonly id = FEATURE_SYNC_NODES.CODING_PLAN;
  readonly title = 'Coding Plan';

  readonly promptType = LocalPromptType.startup_session;

  readonly actions: ExternalAgentActionSchemas = featureSyncCodingPlanActions;

  private readonly logger = new Logger(FeatureSyncCodingPlanNode.name);

  @Inject(PrismaService)
  private readonly prisma!: PrismaService;

  constructor(private readonly taskService: TaskService) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const { organizationId } = context.core;

    if (!context.taskId) {
      throw new Error(
        'coding_plan requires context.taskId to assemble the startup_session payload',
      );
    }

    this.logger.debug('Feature sync coding-plan assembling payload', {
      conversationId: context.core.conversationId,
      taskId: context.taskId,
    });

    const task = await this.taskService.findOneForAdapter(
      context.taskId,
      organizationId,
    );
    if (!task) {
      throw new Error(
        `coding_plan could not find task ${context.taskId} for startup_session payload`,
      );
    }

    const reviewFeedback = context.codingPlanPendingReviewFeedback;
    if (reviewFeedback !== undefined) {
      tracker.mutate((draft) => {
        delete draft.codingPlanPendingReviewFeedback;
      });
    }
    const payload = this.buildPayload(
      context.implementationReadiness,
      reviewFeedback,
    );

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Feature Sync — Coding Plan',
        required: false,
        influences: [],
      },
    ];

    return {
      response: '',
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload,
      },
      data: {
        detectedIntent: 'feature_sync_startup_session',
        intentConfidence: 1,
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<FeatureSyncFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    // Parse the authoritative answer before recording routing settings;
    // the plan and accompanying feedback remain in conversation history.
    const data = (userMessage.data ?? {}) as Partial<ExternalAgentFlowData>;

    if (data.action === WorkflowReviewAction.Refine) {
      // The routing validator rejects a malformed REFINE after this hook
      // runs; only a well-formed answer carries comments worth forwarding.
      const parsed = CodingPlanReviewAnswerPayloadSchema.safeParse(
        data.payload,
      );
      const feedback = parsed.success
        ? renderReviewFeedback(parsed.data)
        : null;
      tracker.mutate((draft) => {
        if (feedback) {
          draft.codingPlanPendingReviewFeedback = feedback;
        } else {
          delete draft.codingPlanPendingReviewFeedback;
        }
      });
      this.logger.debug('Feature sync coding-plan refinement requested', {
        conversationId: tracker.getContext().core.conversationId,
        hasReviewFeedback: feedback !== null,
      });
      return;
    }

    if (data.action === WorkflowReviewAction.Approved) {
      const payload = CodingPlanApprovalPayloadSchema.parse(data.payload);
      if (payload.responseType === 'coding_plan_version_approval_v1') {
        const core = tracker.getContext().core;
        const reviewed = resolveReviewedCodingPlan(
          await this.prisma.db.message.findMany(
            codingPlanMessagesQuery(
              core.organizationId,
              core.projectId,
              core.conversationId,
            ),
          ),
          payload.versionMessageId,
          userMessage.id,
        );
        tracker.mutate((draft) => {
          draft.codingPlanApprovedContext = {
            ...reviewed,
            ...(payload.feedback ? { approvalFeedback: payload.feedback } : {}),
          };
        });
      }
      tracker.mutate((draft) => {
        delete draft.implementRuntime;
        delete draft.implementApprovalOperationId;
      });
      const selectedRuntime =
        payload.responseType === 'coding_plan_version_approval_v1'
          ? payload.runtime
          : payload.provider !== undefined && payload.model !== undefined
            ? {
                provider: payload.provider,
                model: payload.model,
                ...(payload.reasoningEffort !== undefined
                  ? { reasoningEffort: payload.reasoningEffort }
                  : {}),
                ...(payload.fastMode !== undefined
                  ? { fastMode: payload.fastMode }
                  : {}),
              }
            : undefined;
      if (selectedRuntime) {
        tracker.mutate((draft) => {
          draft.implementRuntime = selectedRuntime;
          draft.implementApprovalOperationId =
            userMessage.workflowAnswerOperationId;
        });
      }
      this.logger.debug('Feature sync coding-plan approved', {
        conversationId: tracker.getContext().core.conversationId,
      });
      return;
    }
  }

  private buildPayload(
    implementationReadiness: LocalStartupSessionPromptPayload['implementationReadiness'],
    userMessage: string | undefined,
  ): LocalStartupSessionPromptPayload {
    return {
      ...(implementationReadiness ? { implementationReadiness } : {}),
      ...(userMessage ? { userMessage } : {}),
    };
  }
}

type CodingPlanReviewAnswerPayload = z.infer<
  typeof CodingPlanReviewAnswerPayloadSchema
>;

/**
 * Renders the user's Continue Refining comments as the planner's turn input.
 * Each note is anchored to the step, discrepancy, or question it was written
 * on so the planner can act on it without the review UI. Returns null when
 * the user left no comments.
 */
export function renderReviewFeedback(
  payload: CodingPlanReviewAnswerPayload,
): string | null {
  const sections: string[] = [];

  const general = payload.feedback?.trim();
  if (general) {
    sections.push(`General feedback:\n${general}`);
  }

  const stepNotes = (payload.stepFeedback ?? [])
    .filter((entry) => entry.note.trim())
    .map((entry) => {
      const step = payload.executionPlan.find((s) => s.stepId === entry.stepId);
      const label = step
        ? `Step "${step.title}" (${entry.stepId})`
        : `Step ${entry.stepId}`;
      return `- ${label}: ${entry.note.trim()}`;
    });
  if (stepNotes.length > 0) {
    sections.push(`Feedback on plan steps:\n${stepNotes.join('\n')}`);
  }

  const discrepancyNotes = (payload.discrepancyFeedback ?? [])
    .filter((entry) => entry.note.trim())
    .map((entry) => {
      const discrepancy = payload.discrepancies[entry.discrepancyIndex];
      const label = discrepancy
        ? `Discrepancy "${discrepancy.discrepancyText}"`
        : `Discrepancy ${entry.discrepancyIndex + 1}`;
      return `- ${label}: ${entry.note.trim()}`;
    });
  if (discrepancyNotes.length > 0) {
    sections.push(`Feedback on discrepancies:\n${discrepancyNotes.join('\n')}`);
  }

  const answers = (payload.questionAnswers ?? [])
    .filter((entry) => entry.answer.trim())
    .map((entry) => {
      const question = payload.clarificationQuestions[entry.questionIndex];
      const label = question
        ? `Q: ${question.question}`
        : `Q${entry.questionIndex + 1}`;
      return `- ${label}\n  A: ${entry.answer.trim()}`;
    });
  if (answers.length > 0) {
    sections.push(`Answers to clarification questions:\n${answers.join('\n')}`);
  }

  if (sections.length === 0) return null;
  return `The user reviewed the plan and asked for another revision.\n\n${sections.join('\n\n')}`;
}
