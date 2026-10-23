/**
 * Feature-sync-specific affordances applied at the `assistant_complete`
 * emission point.
 *
 * After the feature-sync agent ends a turn, three outcomes need special
 * handling:
 *
 * - `analyze` turn that ended with `submit_no_discrepancy` — the server has
 *   already routed past `analyze` to `coding_plan`, which waits for any
 *   user message to continue. Attach a `NextStep` secondary action so the
 *   user can advance with one click instead of typing a filler reply.
 * - `iterate` (coding session) turn that ended with `submit_revised` — the
 *   agent has returned a refreshed discrepancy set and asked "are these
 *   good?". Attach a `ContinueConversation` secondary action so the user
 *   can short-circuit the loop.
 * - `plan_shaping_feature_sync_iterate` turn that ended with `submit_revised`
 *   — the flow parks on `parkOnUserResponse: true`, so the review element
 *   must ride on this agent output. Attach the `PlanShapingFeatureSyncReview`
 *   element + "Ignore" / "Keep working" buttons, mirroring what the
 *   FEATURE_SYNC_REVIEW QUESTIONS gate emits for the first pass.
 *
 * Turns that end in `submit_discrepancies` (analyze asking for task-vs-
 * feature decisions) and `submit_resolved` (iterate already terminating)
 * never get a button — the first because the user still has questions to
 * answer, the second because the iterate node has already transitioned.
 */

import { randomUUID } from 'node:crypto';
import { FEATURE_SYNC_ACTIONS } from '../../agents/feature-sync/submission-tools';
import type { SubmissionToolAction } from '../../agents/submission-tools/types';
import {
  ExtendedUIFieldType,
  SecondaryActionConfigTypeEnum,
  SecondaryActionConfigPresentationEnum,
  SecondaryActionHandler,
  SystemMessageDataTypeEnum,
  type QuestionsSystemMessageData,
  type SecondaryActionConfig,
  type UIElement,
  type UpdateMessageDto,
} from '../../shared/api/index';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';

type AffordanceChoice =
  | {
      kind: 'agent_response';
      handler: (typeof SecondaryActionHandler)[keyof typeof SecondaryActionHandler];
    }
  | { kind: 'plan_shaping_review' };

const chooseAffordance = (
  promptType: string | null,
  action: SubmissionToolAction,
): AffordanceChoice | null => {
  if (
    promptType === LocalPromptType.FeatureSyncAnalyze &&
    action.action === FEATURE_SYNC_ACTIONS.NO_DISCREPANCY
  ) {
    return { kind: 'agent_response', handler: SecondaryActionHandler.NextStep };
  }
  if (
    promptType === LocalPromptType.FeatureSyncIterate &&
    action.action === FEATURE_SYNC_ACTIONS.REVISED
  ) {
    return { kind: 'agent_response', handler: SecondaryActionHandler.ContinueConversation };
  }
  if (
    promptType === LocalPromptType.PlanShapingFeatureSyncIterate &&
    action.action === FEATURE_SYNC_ACTIONS.REVISED
  ) {
    return { kind: 'plan_shaping_review' };
  }
  return null;
};

const buildPlanShapingReviewData = (responseText: string): QuestionsSystemMessageData => {
  const reviewFieldId = `fs-review:${randomUUID()}`;
  const reviewElement: UIElement = {
    id: reviewFieldId,
    type: ExtendedUIFieldType.PlanShapingFeatureSyncReview,
    label: 'Review flagged items',
  };

  const secondaryActions: SecondaryActionConfig[] = [
    {
      id: randomUUID(),
      type: SecondaryActionConfigTypeEnum.FieldAction,
      presentation: SecondaryActionConfigPresentationEnum.Button,
      label: 'Continue Revising',
      handler: SecondaryActionHandler.PlanShapingFeatureSyncReviewRequestRevisions,
      fieldId: reviewFieldId,
      disabled: false,
      payload: { handlerType: 'plan_shaping_feature_sync_review_request_revisions' },
    },
    {
      id: randomUUID(),
      type: SecondaryActionConfigTypeEnum.FieldAction,
      presentation: SecondaryActionConfigPresentationEnum.Button,
      label: 'Ready for Plan',
      handler: SecondaryActionHandler.PlanShapingFeatureSyncReviewDone,
      fieldId: reviewFieldId,
      disabled: false,
      payload: { handlerType: 'plan_shaping_feature_sync_review_done' },
    },
  ];

  return {
    type: SystemMessageDataTypeEnum.Questions,
    title: 'Feature Sync Review',
    response: responseText,
    detectedIntent: 'plan_shaping_feature_sync_iterate',
    intentConfidence: 1,
    uiElements: [reviewElement],
    secondaryActions,
  };
};

/**
 * Return a new `UpdateMessageDto` with the appropriate affordance attached
 * when the turn context calls for it. Returns the input unchanged otherwise,
 * so callers can unconditionally pass the dto through this helper.
 */
export const addDataToMessage = (
  dto: UpdateMessageDto,
  ctx: { promptType: string | null; lastSubmissionAction: SubmissionToolAction | null },
): UpdateMessageDto => {
  if (!ctx.lastSubmissionAction) return dto;
  const choice = chooseAffordance(ctx.promptType, ctx.lastSubmissionAction);
  if (!choice) return dto;

  const currentData = dto.data;
  if (!currentData) return dto;

  const responseText = (currentData as { response?: string }).response ?? '';

  if (choice.kind === 'plan_shaping_review') {
    return { ...dto, data: buildPlanShapingReviewData(responseText) };
  }

  const responseElementId = `fs-response:${randomUUID()}`;
  const responseElement: UIElement = {
    id: responseElementId,
    type: ExtendedUIFieldType.AgentResponse,
    label: responseText,
  };

  const nextData: QuestionsSystemMessageData = {
    type: SystemMessageDataTypeEnum.Questions,
    title: 'Feature Sync',
    response: responseText,
    detectedIntent: 'agent_response',
    intentConfidence: 1,
    uiElements: [responseElement],
  };

  return { ...dto, data: nextData };
};
