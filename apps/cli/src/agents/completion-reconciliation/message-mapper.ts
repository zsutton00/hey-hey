import type { UpdateMessageDto, VerifyFeatureElement } from '../../shared/api/generated/api';
import type { UserLaunchablePromptTypeHandler } from '../prompt-type-handler';
import type { CompletionResponse, FeatureVerificationSuggestion } from './schemas';
import { isStructuredCompletionResponse, parseCompletionResponse } from './parser';

export function mapCompletionResponse(result: CompletionResponse): UpdateMessageDto {
  return {
    data: {
      type: 'AGENT',
      response: result.response,
      detectedIntent: 'agent_response',
      intentConfidence: 1,
    },
  };
}

/** Attaches the Verify Feature action for a concern the agent raised through its tool. */
export function withFeatureVerificationSuggestion(
  dto: UpdateMessageDto,
  suggestion: FeatureVerificationSuggestion | null,
): UpdateMessageDto {
  if (suggestion === null || !dto.data) return dto;
  const field = {
    id: 'verify-feature',
    type: 'verify_feature',
    label: 'Verify Feature',
    payload: suggestion,
    secondaryAction: {
      id: 'verify-feature-action',
      type: 'field_action',
      label: 'Verify Feature',
      fieldId: 'verify-feature',
      handler: 'verify_feature',
      presentation: 'INLINE',
    },
  } satisfies VerifyFeatureElement;
  return { ...dto, data: { ...dto.data, uiElements: [field] } };
}

export const completionResponseHooks = {
  isCompletionOutput(event) {
    return isStructuredCompletionResponse(event.summary);
  },
  validateCompletion(event) {
    const result = parseCompletionResponse(event.summary);
    return result.ok ? { ok: true } : result;
  },
  transformCompletionOutput(event) {
    const result = parseCompletionResponse(event.summary);
    return result.ok ? mapCompletionResponse(result.value) : null;
  },
  async onInvalidCompletion(_event, context, deps, failure) {
    deps.logger.warn('completion_reconciliation.rejected', {
      runId: context.runId,
      stamp: context.stamp,
      code: failure.code,
    });
  },
  async onComplete(_event, context, deps) {
    deps.logger.debug('completion_reconciliation.accepted', {
      runId: context.runId,
      stamp: context.stamp,
    });
  },
} satisfies Pick<
  UserLaunchablePromptTypeHandler<object>,
  | 'isCompletionOutput'
  | 'validateCompletion'
  | 'transformCompletionOutput'
  | 'onInvalidCompletion'
  | 'onComplete'
>;

export const changedFileReportingDuty = { requiresChangedFileReporting: true } as const;
