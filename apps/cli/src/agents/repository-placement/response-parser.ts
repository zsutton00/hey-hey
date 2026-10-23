import { jsonrepair } from 'jsonrepair';
import { parseRepositoryPlacementCompletion } from './schemas';

export const parseRepositoryPlacementCompletionFromText = (text: string) => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/giu.exec(text)?.[1]?.trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  const candidate =
    fenced ??
    (firstBrace >= 0 && lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1) : null);
  if (!candidate) return { ok: false as const, error: 'The provider returned no JSON object.' };
  try {
    return parseRepositoryPlacementCompletion(JSON.parse(jsonrepair(candidate)) as unknown);
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : 'The provider returned invalid JSON.',
    };
  }
};
