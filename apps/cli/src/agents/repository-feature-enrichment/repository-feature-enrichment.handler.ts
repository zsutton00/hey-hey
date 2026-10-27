import {
  LocalPromptType,
  type RepositoryFeatureEnrichmentRequest,
} from '../../shared/agent-bridge-contract/generated/api';
import { createAgentBridgeRuntimeValidator } from '../../shared/agent-bridge-contract/runtime-schema-validator';
import type { AgenticSession } from '../../session/types';
import {
  PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
} from '../mcp-server-config';
import {
  turnUserMessageBlock,
  type PrepareResult,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildRepositoryFeatureEnrichmentPrompt } from './repository-feature-enrichment-prompt';
import type { RepositoryFeatureEnrichmentPromptPayload } from './types';

const CONTEXT_KEY = 'repositoryFeatureEnrichment';
const readHandoff = createAgentBridgeRuntimeValidator<RepositoryFeatureEnrichmentRequest>(
  'RepositoryFeatureEnrichmentRequest',
);

/** Ordinary conversation after import; the API workflow has already finished. */
export class RepositoryFeatureEnrichmentHandler implements UserLaunchablePromptTypeHandler<RepositoryFeatureEnrichmentPromptPayload> {
  readonly id = 'repository-feature-enrichment';
  readonly promptType = LocalPromptType.RepositoryFeatureEnrichment;
  readonly service = 'required';
  readonly launchEntity = 'none';
  readonly implementationReadiness = 'none';
  readonly runnerKind = 'provider_session' as const;
  readonly providerSessionCountsForContext = true;
  readonly providerSessionLifetime = 'run' as const;
  readonly retainsConversationAfterWorkflow = true;
  readonly readOnlyFilesystem = true;
  readonly repositoryResearch = { delegation: 'allowed' as const };
  readonly mcpToolUseCase = 'repository_placement' as const;
  readonly additionalAllowedTools = [
    PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
    PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
    'get_proposal',
    'update_proposal',
    'get_full_entity',
    'get_work_item_type_guidance_batch',
  ];
  readonly builtinTools = [];
  readonly omitServiceContextNote = true;
  readonly reports = [];
  readonly addUserMessage = (payload: RepositoryFeatureEnrichmentPromptPayload) =>
    turnUserMessageBlock(payload.userMessage);

  async prepare(
    run: AgenticSession,
    payload: RepositoryFeatureEnrichmentPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<RepositoryFeatureEnrichmentPromptPayload>> {
    let handoff: RepositoryFeatureEnrichmentRequest;
    if ('analysis' in payload) {
      handoff = payload;
    } else {
      const saved = run.sessionContext?.[CONTEXT_KEY];
      if (!readHandoff(saved))
        throw new Error('The saved Feature enrichment handoff is missing or invalid.');
      handoff = saved;
    }
    if (
      run.launchServiceId !== handoff.serviceId ||
      !run.services.some((service) => service.id === handoff.serviceId)
    )
      throw new Error('The selected Service is not the Run-owned launch workspace.');
    deps.logger.info('repository_feature_enrichment.conversation_prepared', {
      runId: run.agentic_session_id,
      serviceId: handoff.serviceId,
      featureCount: handoff.materializedFeatureIds.length,
      resuming: !('analysis' in payload),
    });
    const { userMessage: _previousMessage, ...savedHandoff } = handoff;
    return {
      payload: {
        ...savedHandoff,
        ...(payload.userMessage === undefined ? {} : { userMessage: payload.userMessage }),
      },
      sessionContext: { [CONTEXT_KEY]: savedHandoff },
    };
  }

  resolveProviderExecution(payload: RepositoryFeatureEnrichmentPromptPayload) {
    if (!('analysis' in payload)) throw new Error('Enrichment conversation was not prepared.');
    return { provider: payload.provider, model: payload.resolvedFrontierModel };
  }

  buildPrompt(payload: RepositoryFeatureEnrichmentPromptPayload): string {
    if (!('analysis' in payload)) throw new Error('Enrichment conversation was not prepared.');
    return buildRepositoryFeatureEnrichmentPrompt(payload);
  }

  buildStartingMessage = (): string => 'Exploring the intent and requirements of your Features...';
}

export const repositoryFeatureEnrichmentHandler = new RepositoryFeatureEnrichmentHandler();
