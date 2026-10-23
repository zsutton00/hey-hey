/**
 * Prompt resolution — stateless utility.
 *
 * Takes a LocalRunPromptRequest (promptType + payload) and returns
 * the fully-built prompt string to send to the provider.
 *
 * For typed prompt types (startup_session, entity_conversation, etc.)
 * this calls the corresponding prompt builder.
 */

import type {
  LocalStartupSessionPromptPayload,
  LocalFinalAssessmentPromptPayload,
  LocalVerificationPlanPromptPayload,
  LocalChildTaskUpdatesPromptPayload,
  LocalSetSplittingPromptPayload,
  LocalFreeFormPromptPayload,
  LocalEntityConversationPromptPayload,
  LocalCodingFreeformPromptPayload,
  LocalCommitPromptPayload,
  LocalDailySessionPromptPayload,
  LocalRollupProposalPromptPayload,
  LocalTaskRefinerPromptPayload,
  LocalFeatureRefinerPromptPayload,
  LocalDesignDocRefinerPromptPayload,
  LocalProposalRefinerPromptPayload,
  LocalAgentSearchPromptPayload,
  LocalReportUpdatePromptPayload,
  LocalCodeReviewPromptPayload,
  LocalValidationWalkthroughPromptPayload,
  LocalFeatureTreeConversationPromptPayload,
} from '../../shared/agent-bridge-contract/index';

/**
 * Local "any in-memory handler payload" union over the named generated payload
 * types. The wire-level `LocalRunPromptRequest.payload` is narrowed to
 * follow-up-only coding_freeform variant; this utility runs on the
 * broader in-memory Run/Turn payload threaded through resolve-prompt.
 */
type AnyHandlerPayload =
  | LocalStartupSessionPromptPayload
  | LocalFinalAssessmentPromptPayload
  | LocalVerificationPlanPromptPayload
  | LocalChildTaskUpdatesPromptPayload
  | LocalEntityConversationPromptPayload
  | LocalSetSplittingPromptPayload
  | LocalFreeFormPromptPayload
  | LocalDailySessionPromptPayload
  | LocalRollupProposalPromptPayload
  | LocalTaskRefinerPromptPayload
  | LocalFeatureRefinerPromptPayload
  | LocalDesignDocRefinerPromptPayload
  | LocalProposalRefinerPromptPayload
  | LocalCommitPromptPayload
  | LocalAgentSearchPromptPayload
  | LocalReportUpdatePromptPayload
  | LocalCodeReviewPromptPayload
  | LocalValidationWalkthroughPromptPayload
  | LocalCodingFreeformPromptPayload
  | LocalFeatureTreeConversationPromptPayload;
import {
  resolvePromptText,
  type LocalRunPromptRequest,
} from '../../shared/agent-bridge-contract/contract';
import {
  buildCodingPlanPrompt,
  buildFinalAssessmentPrompt,
  buildVerificationPlanPrompt,
  buildChildTaskUpdatesPrompt,
  buildSetSplittingPrompt,
  buildEntityConversationPrompt,
  buildCodingConversationPrompt,
} from './index';

// ---------------------------------------------------------------------------
// Typed dispatch union
// ---------------------------------------------------------------------------

/**
 * Discriminated union that pairs promptType with its payload type.
 * The local AnyHandlerPayload union doesn't have a tight discriminator the
 * compiler can narrow from a sibling promptType field; this dispatch union
 * lets the switch narrow naturally.
 */
type TypedPromptDispatch =
  | { promptType: 'startup_session'; payload: LocalStartupSessionPromptPayload }
  | { promptType: 'final_assessment'; payload: LocalFinalAssessmentPromptPayload }
  | { promptType: 'verification_plan'; payload: LocalVerificationPlanPromptPayload }
  | { promptType: 'child_task_updates'; payload: LocalChildTaskUpdatesPromptPayload }
  | { promptType: 'set_splitting'; payload: LocalSetSplittingPromptPayload }
  | { promptType: 'free_form'; payload: LocalFreeFormPromptPayload }
  | { promptType: 'entity_conversation'; payload: LocalEntityConversationPromptPayload };

const toTypedPromptDispatch = (
  promptType: string,
  payload: AnyHandlerPayload,
): TypedPromptDispatch | null => {
  switch (promptType) {
    case 'startup_session':
    case 'final_assessment':
    case 'verification_plan':
    case 'child_task_updates':
    case 'set_splitting':
    case 'free_form':
    case 'entity_conversation':
      return { promptType, payload } as TypedPromptDispatch;
    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// resolvePromptString
// ---------------------------------------------------------------------------

/**
 * Resolve a prompt string from a LocalRunPromptRequest.
 * Supports typed prompt payloads.
 */
export const resolvePromptString = (input: LocalRunPromptRequest): string | null => {
  if (!input.payload) {
    return null;
  }

  const typed = toTypedPromptDispatch(input.promptType, input.payload as AnyHandlerPayload);
  if (!typed) {
    return null;
  }

  switch (typed.promptType) {
    case 'startup_session':
      return buildCodingPlanPrompt(typed.payload);
    case 'final_assessment':
      return buildFinalAssessmentPrompt(typed.payload);
    case 'verification_plan':
      return buildVerificationPlanPrompt(typed.payload);
    case 'child_task_updates':
      return buildChildTaskUpdatesPrompt(typed.payload);
    case 'set_splitting':
      return buildSetSplittingPrompt(typed.payload);
    case 'free_form':
      return buildCodingConversationPrompt(typed.payload, { kind: 'launch' });
    case 'entity_conversation':
      return buildEntityConversationPrompt(typed.payload);
  }
};
