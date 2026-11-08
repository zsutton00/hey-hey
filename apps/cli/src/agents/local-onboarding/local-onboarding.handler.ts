import { setTimeout as delay } from 'node:timers/promises';
import { ConversationsApi } from '@hey-hey/contracts/api';
import { Configuration } from '@hey-hey/contracts/api/configuration';
import type { LocalOnboardingStepRequest } from '@hey-hey/contracts/api/models';
import {
  SessionRole,
  LocalPromptType,
  type RunCreatePayloadLocalOnboarding,
} from '@hey-hey/contracts/agent-bridge';
import {
  defaultAddUserMessage,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';

/** The Run owns execution; server snapshots own every prompt and continuation. */
export const localOnboardingHandler: UserLaunchablePromptTypeHandler<RunCreatePayloadLocalOnboarding> =
  {
    id: 'local_onboarding',
    sessionRole: SessionRole.Research,
    promptType: LocalPromptType.LocalOnboarding,
    service: 'optional',
    launchEntity: 'none',
    implementationReadiness: 'none',
    runnerKind: 'procedural',
    providerSessionCountsForContext: false,
    reports: [],
    buildPrompt: () => '',
    buildStartingMessage: () => 'Starting project onboarding...',
    addUserMessage: defaultAddUserMessage,
    async runProcedure(payload, { session, deps, provider }, signal) {
      const client = new ConversationsApi(
        new Configuration({
          accessToken: () => deps.auth.getAccessToken(),
          basePath: deps.apiBaseUrl,
        }),
      );
      let result: Pick<LocalOnboardingStepRequest, 'requestId' | 'outputText'> = {};
      while (!signal.aborted) {
        const response = await client.advanceLocalOnboarding({
          organizationId: session.contextMetadata.organizationId,
          projectId: session.contextMetadata.projectId,
          conversationId: payload.conversationId,
          localOnboardingStepRequest: { agentSessionId: session.agentic_session_id, ...result },
        });
        const step = response.data.data;
        if (!step) {
          throw new Error('The server returned no onboarding progress');
        }
        result = {};
        if (step.state === 'COMPLETED') {
          return 'Project onboarding is complete.';
        }
        if (step.state === 'WAITING_FOR_USER') {
          provider.settleWhileWaiting();
          await delay(1000, undefined, { signal });
          continue;
        }
        if (!step.requestId || !step.prompt) {
          throw new Error('The server returned an incomplete onboarding request');
        }
        deps.logger.debug('local_onboarding.provider_request', {
          requestId: step.requestId,
          conversationId: payload.conversationId,
        });
        const outputText = await provider.generate(step.prompt, signal);
        result = { requestId: step.requestId, outputText };
      }
      return 'Project onboarding is paused.';
    },
  };
