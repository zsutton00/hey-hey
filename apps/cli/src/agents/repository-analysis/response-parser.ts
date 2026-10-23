import { jsonrepair } from 'jsonrepair';
import { parseRepositoryAnalysisCompletion, type RepositoryAnalysisParseResult } from './schemas';
import type { RepositoryAnalysisCompletion } from './types';

const extractJson = (text: string): string | null => {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/giu;
  let fallback: string | null = null;
  for (const match of text.matchAll(fenced)) {
    const content = match[1]?.trim();
    if (!content) continue;
    fallback ??= content;
  }
  if (fallback) return fallback;

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  return text.slice(firstBrace, lastBrace + 1).trim();
};

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    try {
      return { ok: true, value: JSON.parse(jsonrepair(text)) as unknown };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The provider returned invalid JSON.',
      };
    }
  }
};

const parseText = (text: string): RepositoryAnalysisParseResult<RepositoryAnalysisCompletion> => {
  const extracted = extractJson(text);
  if (!extracted) return { ok: false, error: 'The provider returned no JSON object.' };
  const parsedJson = parseJson(extracted);
  if (!parsedJson.ok) return parsedJson;
  return parseRepositoryAnalysisCompletion(parsedJson.value);
};

export const parseRepositoryAnalysisCompletionResponseFromText = parseText;
export const parseRepositoryAnalysisCompletionFromText = parseText;
