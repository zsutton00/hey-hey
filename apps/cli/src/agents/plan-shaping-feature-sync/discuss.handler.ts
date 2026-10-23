/**
 * `plan_shaping_feature_sync_discuss` prompt-type handler.
 *
 * Invoked by the CLI when a chat message arrives while the plan-shaping flow
 * is parked on the feature-sync review gate. Unlike the analyze and iterate
 * handlers, this one is never driven by a platform EXTERNAL_AGENT trigger: the
 * message-service edge resolves the `workflow-defined` sentinel, sees a
 * `FEATURE_SYNC_REVIEW` gate on the prompt-type response, and synthesizes this
 * turn with the gate's design doc, plan, and outstanding flagged items.
 *
 * The persona reuses the pre-check voice and the iterate prompt's
 * outstanding-items rendering, anchored on the design doc. It has NO
 * submission tools — there is no completion path, so the turn cannot post a
 * workflow completion or advance the review; the review's Done action (which
 * never batch-approves) is the user's alone. `edit_work_item` stays available
 * because it is a base provider tool frozen at session mint and the Run-lived
 * provider session is shared with analyze/iterate turns — so the user can
 * direct drafts from chat, each rendered as its own individually-decidable
 * proposal card that is never auto-accepted.
 */

import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalPlanShapingFeatureSyncDiscussPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import { turnUserMessageBlock, type UserLaunchablePromptTypeHandler } from '../prompt-type-handler';
import { buildPlanShapingDiscussPrompt } from './prompts';

export const planShapingFeatureSyncDiscussHandler: UserLaunchablePromptTypeHandler<LocalPlanShapingFeatureSyncDiscussPromptPayload> =
  {
    id: 'plan_shaping_feature_sync_discuss',
    promptType: LocalPromptType.PlanShapingFeatureSyncDiscuss,
    service: 'optional',
    launchEntity: 'none',
    implementationReadiness: 'none',
    graphResearchGuidance: true,
    epistemicCalibration: true,
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],

    // No completion path: the review's Done action — not this turn — decides
    // what advances, so the turn must not be able to post a workflow
    // completion. The request is also dispatched with `awaitingUserReview`,
    // which makes the runtime clear any action tools a prior analyze/iterate
    // turn left registered on this shared Run.
    submissionTools: [],

    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

    buildPrompt(payload: LocalPlanShapingFeatureSyncDiscussPromptPayload): string {
      return buildPlanShapingDiscussPrompt({
        planId: payload.planId,
        designDocId: payload.designDocId,
        discrepancies: payload.discrepancies,
      });
    },

    buildStartingMessage(): string | null {
      return 'Taking a look...';
    },
  };
