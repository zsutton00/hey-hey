// Every iterate trigger carries the outstanding flagged items (with stable ids,
// in display order) and the user's per-item choices; the prompt renders them so
// a reply like "6" resolves without relying on provider session history.
// Exposes `submit_revised` as the sole legal turn-completion path; resolution
// is not claimable here, the user's review gate decides what advances.

import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalPlanShapingFeatureSyncIteratePromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import { turnUserMessageBlock, type UserLaunchablePromptTypeHandler } from '../prompt-type-handler';
import { buildPlanShapingIteratePrompt } from './prompts';
import { submitPlanShapingRevisedTool } from '../feature-sync/submission-tools';

export const planShapingFeatureSyncIterateHandler: UserLaunchablePromptTypeHandler<LocalPlanShapingFeatureSyncIteratePromptPayload> =
  {
    id: 'plan_shaping_feature_sync_iterate',
    promptType: LocalPromptType.PlanShapingFeatureSyncIterate,
    service: 'optional',
    launchEntity: 'required',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],

    submissionTools: [submitPlanShapingRevisedTool],

    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

    buildPrompt(payload): string {
      return buildPlanShapingIteratePrompt({
        discrepancies: payload.discrepancies,
        decisions: payload.decisions,
      });
    },

    buildStartingMessage(): string | null {
      return 'Working through your updates...';
    },
  };
