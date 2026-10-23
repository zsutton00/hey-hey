/**
 * Resolve the onboarding ingress marker without inspecting mutable state.
 * Keeping this decision pure makes direct workflow starts follow the same
 * repository-grounding entry path as service-created onboarding sessions.
 */
export function resolveOnboardingAdditionalContext(params: {
  flowId: string;
  conversationId?: string | null;
  additionalContext?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  const { flowId, conversationId, additionalContext } = params;
  if (
    flowId === 'onboarding' &&
    !conversationId &&
    additionalContext?.repositoryGrounding === undefined &&
    additionalContext?.repositoryGroundingIntentRequired === undefined
  ) {
    return {
      ...(additionalContext ?? {}),
      repositoryGroundingIntentRequired: true,
    };
  }
  return additionalContext;
}

/** @deprecated Use resolveOnboardingAdditionalContext. */
export const resolveRepositoryGroundingAdditionalContext =
  resolveOnboardingAdditionalContext;
