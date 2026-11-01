import type { TokenUsage } from '../session/types';

/** Codex input consists of fresh input and cache reads; cache creation is not an input component. */
export function getCacheInclusiveInputTokens(
  provider: string,
  usage: Pick<
    Partial<TokenUsage>,
    'inputTokens' | 'cacheReadInputTokens' | 'cacheCreationInputTokens'
  >,
): number | undefined {
  const { inputTokens, cacheReadInputTokens, cacheCreationInputTokens } = usage;
  if (inputTokens == null || cacheReadInputTokens == null) {
    return undefined;
  }
  if (provider === 'codex') {
    return inputTokens + cacheReadInputTokens;
  }
  if (cacheCreationInputTokens == null) {
    return undefined;
  }
  return inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
}
