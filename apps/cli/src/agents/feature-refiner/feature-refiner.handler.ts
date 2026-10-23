import type { LocalFeatureRefinerPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import {
  defaultAddUserMessage,
  type UserLaunchablePromptTypeHandler,
  type PromptTypeHandlerDeps,
  type PrepareResult,
} from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import type { AssistantDeltaEvent, AssistantCompleteEvent } from '../../run/types';
import type { UpdateMessageDto } from '../../shared/api/index';
import { SystemMessageDataTypeEnum } from '../../shared/api/index';
import type { FeatureRefinerPromptInput } from './types';
import type { FullEntityContextDto } from '../../shared/api/generated/api';
import { buildFeatureRefinerPrompt } from './feature-refiner-prompt';
import { extractStructuredJsonPayload } from '../response-parser';
import { ExtendedUIFieldType } from '../../shared/api/index';
import { assertFullProposalHistory } from '../entity-context/full-proposal-history';

const parseFeatureRefinerResponse = (text: string): string | null => {
  const payload = extractStructuredJsonPayload(text);
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const response = typeof obj['response'] === 'string' ? obj['response'].trim() : null;
  return response && response.length > 0 ? response : null;
};

/**
 * Extended payload that carries enriched context through the handler lifecycle.
 * The API contract is thin (payloadVersion + feature); prepare() enriches it
 * with fetched entity context for buildPrompt to consume.
 */
type EnrichedPayload = LocalFeatureRefinerPromptPayload & {
  _enriched?: FeatureRefinerPromptInput;
};

export const featureRefinerHandler: UserLaunchablePromptTypeHandler<LocalFeatureRefinerPromptPayload> =
  {
    id: 'feature_refiner',
    promptType: 'feature_refiner',
    service: 'required',
    launchEntity: 'required',
    implementationReadiness: 'none',
    projectAssistant: {
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'all',
    },
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],

    async prepare(
      run: AgenticSession,
      payload: LocalFeatureRefinerPromptPayload,
      deps: PromptTypeHandlerDeps,
    ): Promise<PrepareResult<LocalFeatureRefinerPromptPayload>> {
      const featureId = payload.feature.id;
      const { organizationId, projectId } = run.contextMetadata;
      if (!featureId || !organizationId || !projectId) {
        return { payload };
      }

      let accessToken: string;
      try {
        accessToken = await deps.auth.getAccessToken();
      } catch {
        deps.logger.warn('feature_refiner.prepare.auth_failed', {
          runId: run.agentic_session_id,
        });
        return { payload };
      }

      try {
        const path = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/entities/TASK/${encodeURIComponent(featureId)}/context?proposalDetail=full`;
        const res = await deps.fetchImpl(`${deps.apiBaseUrl}${path}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!res.ok) {
          deps.logger.warn('feature_refiner.prepare.context_fetch_failed', {
            runId: run.agentic_session_id,
            status: res.status,
          });
          return { payload };
        }

        const body = (await res.json()) as { data?: FullEntityContextDto };
        const ctx = body.data;

        const input: FeatureRefinerPromptInput = { feature: payload.feature };
        if (ctx?.relatedEntities && ctx.relatedEntities.length > 0)
          input.relatedEntities = ctx.relatedEntities;
        if (ctx?.agentSessions && ctx.agentSessions.length > 0)
          input.agentSessions = ctx.agentSessions;
        if (ctx?.proposals && ctx.proposals.length > 0) {
          assertFullProposalHistory(ctx.proposals);
          input.proposals = ctx.proposals;
        }

        const enriched: EnrichedPayload = { ...payload, _enriched: input };
        return { payload: enriched };
      } catch (err) {
        deps.logger.warn('feature_refiner.prepare.context_fetch_error', {
          runId: run.agentic_session_id,
          error: err,
        });
        return { payload };
      }
    },

    buildPrompt(payload: LocalFeatureRefinerPromptPayload): string {
      const enriched = (payload as EnrichedPayload)._enriched;
      if (enriched) {
        return buildFeatureRefinerPrompt(enriched);
      }
      return buildFeatureRefinerPrompt({ feature: payload.feature });
    },

    addUserMessage: defaultAddUserMessage,

    buildStartingMessage(_payload: LocalFeatureRefinerPromptPayload): string | null {
      return 'Setting up feature refiner...';
    },

    transformOutput(event: AssistantDeltaEvent | AssistantCompleteEvent): UpdateMessageDto | null {
      const response = parseFeatureRefinerResponse(event.summary);
      if (!response) return null;

      return {
        data: {
          type: SystemMessageDataTypeEnum.Agent,
          response,
          title: 'Feature Refinement',
          detectedIntent: 'feature_refiner',
          intentConfidence: 1,
          ragEnabled: false,
        },
      };
    },
  };
