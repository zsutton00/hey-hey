import { z } from 'zod';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import type { VerifyFeaturePromptPayload } from '../../shared/agent-bridge-contract/generated';
import { completionResponseHooks } from '../completion-reconciliation/message-mapper';
import { ENTITY_CONVERSATION_ALLOWED_TOOLS } from '../entity-conversation/entity-conversation.handler';
import {
  defaultAddUserMessage,
  type PromptTypeHandlerContext,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { SUGGEST_FEATURE_VERIFICATION_TOOL_NAME } from '../submission-tools/suggest-feature-verification-tool';
import type { PassThroughSubmissionToolDeclaration } from '../submission-tools/types';
import { buildVerifyFeaturePrompt, buildVerifyFeaturePromptSegments } from './prompt';

const payloadShape = {
  concern: z.string().min(1),
  parentAgentSessionId: z.string().uuid(),
  // Launches from suggestions saved before the field existed omit it (spec default: []).
  impactedEntities: z
    .array(z.object({ entityType: z.string().min(1), entityId: z.string().uuid() }).strict())
    .default([]),
  userMessage: z.string(),
} satisfies Record<keyof VerifyFeaturePromptPayload, z.ZodTypeAny>;
// Start-run payloads reach the CLI unchecked and a user reply carries only its message, so the
// full payload is validated where a prompt is built from it, never on a reply that keeps the mode.
const payloadSchema = z.object(payloadShape);

/**
 * The mode reads the parent session itself rather than relying on a Project
 * Assistant preamble, so it grants `get_agent_session` to its own surface.
 */
const VERIFY_FEATURE_ALLOWED_TOOLS: readonly string[] = [
  'get_agent_session',
  ...ENTITY_CONVERSATION_ALLOWED_TOOLS,
];

export class VerifyFeatureHandler implements UserLaunchablePromptTypeHandler<VerifyFeaturePromptPayload> {
  // The id owns the provider session, so a swap with entity_conversation
  // rotates it once instead of resuming a transcript with other instructions.
  public readonly id = 'verify_feature';
  public readonly promptType = LocalPromptType.VerifyFeature;
  public readonly service = 'optional';
  public readonly launchEntity = 'required';
  public readonly implementationReadiness = 'none';
  public readonly eligibleWorkItemTypeKeys = ['FEATURE'] as const;
  public readonly graphResearchGuidance = true;
  public readonly epistemicCalibration = true;
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly reports = [];
  public readonly excludedBaseSubmissionTools = [SUGGEST_FEATURE_VERIFICATION_TOOL_NAME];
  public readonly mcpToolUseCase = 'general' as const;
  public readonly additionalAllowedTools = VERIFY_FEATURE_ALLOWED_TOOLS;
  public readonly defaultReasoningEffort = 'high' as const;
  public readonly addUserMessage = defaultAddUserMessage;
  public isCompletionOutput = completionResponseHooks.isCompletionOutput;
  public validateCompletion = completionResponseHooks.validateCompletion;
  public transformCompletionOutput = completionResponseHooks.transformCompletionOutput;
  public readonly requiresChangedFileReporting = true;
  public onInvalidCompletion = completionResponseHooks.onInvalidCompletion;
  public onComplete = completionResponseHooks.onComplete;

  public constructor(public readonly submissionTools: PassThroughSubmissionToolDeclaration[]) {}

  public buildPrompt(payload: VerifyFeaturePromptPayload, context?: PromptTypeHandlerContext) {
    return buildVerifyFeaturePrompt(payloadSchema.parse(payload), context?.loadedEntityContext);
  }

  public buildPromptSegments(
    payload: VerifyFeaturePromptPayload,
    context?: PromptTypeHandlerContext,
  ) {
    return buildVerifyFeaturePromptSegments(
      payloadSchema.parse(payload),
      context?.loadedEntityContext,
    );
  }

  public buildStartingMessage(): string {
    return 'Looking into the flagged concern...';
  }
}
