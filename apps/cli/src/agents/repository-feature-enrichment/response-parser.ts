import { jsonrepair } from 'jsonrepair';
import { parseRepositoryFeatureEnrichmentCompletion } from './schemas';
import type { RepositoryFeatureEnrichmentParseResult } from './types';

export function parseRepositoryFeatureEnrichmentCompletionFromText(
  text: string,
): RepositoryFeatureEnrichmentParseResult {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)?.[1]?.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const candidate = fenced ?? (start >= 0 && end > start ? text.slice(start, end + 1) : undefined);
  if (!candidate) return { ok: false, error: 'The provider returned no JSON object.' };
  try {
    return parseRepositoryFeatureEnrichmentCompletion(JSON.parse(jsonrepair(candidate)));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The provider returned invalid JSON.',
    };
  }
}
