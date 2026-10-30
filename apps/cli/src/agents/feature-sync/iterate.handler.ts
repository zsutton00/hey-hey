/**
 * `feature_sync_iterate` prompt-type handler.
 *
 * Invoked by the CLI when the server-side `iterate` EXTERNAL_AGENT node
 * (`api/src/flows/nodes/feature-sync/iterate.node.ts`) is active — i.e.
 * after `analyze` emitted DISCREPANCY, or while iterate self-loops on
 * REVISED. The handler exposes `submit_resolved` and `submit_revised`
 * as the only legal turn-completion paths; the server's action schemas
 * (`featureSyncIterateActions`) re-validate the payload.
 */

import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalFeatureSyncIteratePromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import { turnUserMessageBlock, type UserLaunchablePromptTypeHandler } from '../prompt-type-handler';
import { buildIteratePrompt } from './prompts';
import { iterateSubmissionTools } from './submission-tools';

export const featureSyncIterateHandler: UserLaunchablePromptTypeHandler<LocalFeatureSyncIteratePromptPayload> =
  {
    id: 'feature_sync_iterate',
    promptType: LocalPromptType.FeatureSyncIterate,
    service: 'required',
    launchEntity: 'required',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],

    submissionTools: [...iterateSubmissionTools],

    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

    buildPrompt(payload: LocalFeatureSyncIteratePromptPayload, ctx): string {
      return buildIteratePrompt({ discrepancies: payload.discrepancies, provider: ctx?.provider });
    },

    buildStartingMessage(): string | null {
      return 'Working through your updates...';
    },
  };
