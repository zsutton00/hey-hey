import {
  SessionRole,
  LocalPromptType,
  type RepositoryFeatureEnrichmentRequest,
} from '@hey-hey/contracts/agent-bridge';
import {
  ExtendedUIFieldType,
  SystemMessageDataTypeEnum,
  type UIElement,
} from '@hey-hey/contracts/api/models';
import type { UpdateMessageDto } from '../../shared/api';
import type { AssistantCompleteEvent } from '../../run/types';
import { createAgentBridgeRuntimeValidator } from '../../shared/agent-bridge-contract/runtime-schema-validator';
import type { AgenticSession } from '../../session/types';
import {
  PROJECT_ASSISTANT_EDIT_WORK_ITEM_MCP_TOOL,
  PROJECT_ASSISTANT_WORK_ITEM_GUIDANCE_MCP_TOOL,
} from '../mcp-server-config';
import {
  turnUserMessageBlock,
  type CompletionOutputDiagnostics,
  type PrepareResult,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { runtimeFromHandoff } from '../handoff-runtime';
import { parseEnrichmentQuestions } from './enrichment-questions';
import { buildRepositoryFeatureEnrichmentPrompt } from './repository-feature-enrichment-prompt';
import type { RepositoryFeatureEnrichmentPromptPayload } from './types';

const CONTEXT_KEY = 'repositoryFeatureEnrichment';
const readHandoff = createAgentBridgeRuntimeValidator<RepositoryFeatureEnrichmentRequest>(
  'RepositoryFeatureEnrichmentRequest',
);

/** Ordinary conversation after import; the API workflow has already finished. */
export class RepositoryFeatureEnrichmentHandler implements UserLaunchablePromptTypeHandler<RepositoryFeatureEnrichmentPromptPayload> {
  readonly id = 'repository-feature-enrichment';
  readonly sessionRole = SessionRole.Research;
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

  /** Only the handoff carries a runtime; a reply carries none and keeps the saved one. */
  resolveRuntime(payload: RepositoryFeatureEnrichmentPromptPayload) {
    if (!('analysis' in payload)) {
      return undefined;
    }

    return runtimeFromHandoff(payload);
  }

  buildPrompt(payload: RepositoryFeatureEnrichmentPromptPayload): string {
    if (!('analysis' in payload)) throw new Error('Enrichment conversation was not prepared.');
    return buildRepositoryFeatureEnrichmentPrompt(payload);
  }

  /**
   * Gives every enrichment message something to answer with: one field per
   * question when the agent supplied a readable question block, otherwise the
   * single reply field. The import workflow cannot take replies.
   */
  transformCompletionOutput(
    event: AssistantCompleteEvent,
    _payload?: unknown,
    diagnostics?: CompletionOutputDiagnostics,
  ): UpdateMessageDto {
    const parsed = parseEnrichmentQuestions(event.summary);

    if (parsed.kind === 'invalid') {
      diagnostics?.logger.warn('repository_feature_enrichment.questions_unreadable', {
        runId: diagnostics.runId,
        cause: parsed.cause,
      });
    }

    const questions = parsed.kind === 'questions' ? parsed : null;
    const uiElement = questions
      ? ({
          id: 'repository-feature-enrichment-questions',
          type: ExtendedUIFieldType.QuestionGroup,
          label: 'Your answers',
          required: false,
          payload: {
            questions: questions.questions,
            conversationReply: {
              noteLabel: 'Anything else?',
              notePlaceholder: 'Add a note, correct something, or tell me that is enough...',
            },
          },
          submitText: 'Send',
        } satisfies UIElement)
      : ({
          id: 'repository-feature-enrichment-reply',
          type: ExtendedUIFieldType.RepositoryFeatureEnrichmentReply,
          label: 'Your answer',
          placeholder: 'Answer the questions above, or tell me what to change...',
          required: true,
          submitText: 'Send',
        } satisfies UIElement);

    return {
      data: {
        type: SystemMessageDataTypeEnum.Agent,
        response: questions ? questions.visibleText : event.summary,
        detectedIntent: 'agent_response',
        intentConfidence: 1,
        uiElements: [uiElement],
      },
    };
  }

  buildStartingMessage = (): string => 'Exploring the intent and requirements of your Features...';
}

export const repositoryFeatureEnrichmentHandler = new RepositoryFeatureEnrichmentHandler();
