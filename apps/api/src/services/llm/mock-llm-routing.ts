import { LLMProviderName } from './llm-shared';

export const MOCK_LLM_SESSION_HEADER = 'x-mock-session';
export const MOCK_LLM_SESSION_CONTEXT_KEY = 'mockLlmSessionId';

export function isMockLlmSessionRoutingEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment.NODE_ENV !== 'production' &&
    environment.MOCK_LLM_SESSION_ROUTING_ENABLED === 'true'
  );
}

function urlOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function providerTargetsMockLlmServer(
  provider: LLMProviderName,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isMockLlmSessionRoutingEnabled(environment)) return false;

  const mockOrigin = urlOrigin(environment.MOCK_LLM_SERVER_URL);
  if (!mockOrigin) return false;

  const providerUrl =
    provider === LLMProviderName.CLAUDE
      ? environment.ANTHROPIC_BASE_URL
      : provider === LLMProviderName.OPENAI
        ? environment.OPENAI_BASE_URL
        : undefined;

  return urlOrigin(providerUrl) === mockOrigin;
}

export function hasCompleteOnboardingMockProviderConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    providerTargetsMockLlmServer(LLMProviderName.CLAUDE, environment) &&
    providerTargetsMockLlmServer(LLMProviderName.OPENAI, environment)
  );
}
