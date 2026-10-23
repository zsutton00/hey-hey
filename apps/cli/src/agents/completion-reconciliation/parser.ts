import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';
import type { CompletionValidationFailure } from '../prompt-type-handler';
import { completionResponseSchema, type CompletionResponse } from './schemas';

export type CompletionParseResult =
  | { ok: true; value: CompletionResponse }
  | { ok: false; error: CompletionValidationFailure };

const completionCandidate = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
};

function normalizeCompletionCandidate(text: string): string {
  const candidate = completionCandidate(text);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch (error) {
    // Providers can emit literal newlines inside response strings. Keep repair
    // scoped to complete object envelopes so prose and partial JSON retain
    // their existing fallback. Callers still validate the completion schema.
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) throw error;
    return jsonrepair(candidate);
  }
}

export function isStructuredCompletionResponse(text: string): boolean {
  try {
    return completionResponseSchema.safeParse(JSON.parse(normalizeCompletionCandidate(text)))
      .success;
  } catch {
    return false;
  }
}

export function parseCompletionResponse(text: string): CompletionParseResult {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  try {
    const candidate = normalizeCompletionCandidate(text);
    const legacyResponse = z.string().safeParse(JSON.parse(candidate));
    if (legacyResponse.success) {
      const response = legacyResponse.data.trim();
      if (response) {
        return { ok: true, value: { response } };
      }
    }
    const parsed = completionResponseSchema.safeParse(JSON.parse(candidate));
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      error: {
        code: 'INVALID_COMPLETION_RESPONSE',
        message: 'Completion response does not match the required schema.',
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      },
    };
  } catch {
    const response = (fenced?.[1] ?? trimmed).trim();
    if (response) {
      return { ok: true, value: { response } };
    }
    return {
      ok: false,
      error: {
        code: 'INVALID_COMPLETION_JSON',
        message: 'Completion response must be a JSON object.',
      },
    };
  }
}
