import { jsonrepair } from 'jsonrepair';
import type {
  ParseAgentSearchResultsResponseResult,
  ParseChildTaskDescriptionUpdateResponseResult,
  ParseDailySessionResponseResult,
  ParseFinalAssessmentResponseResult,
  ParseGoalPmRoutingResponseResult,
  ParseImplementationReadinessResponseResult,
  ParseNeighborhoodTaskUpdatesResponseResult,
  ParsePlanShapingFeatureSyncAnalyzeResponseResult,
  ParsePlanShapingFeatureSyncIterateResponseResult,
  ParseReportUpdateResponseResult,
  ParseResult,
  ParseRollupProposalResponseResult,
  ParseSetSplittingResponseResult,
  ParseStartupSessionPlanResponseResult,
  ParseVerificationPlanResponseResult,
} from './response-schemas';
import {
  parseAgentSearchResultsResponse,
  parseChildTaskDescriptionUpdateResponse,
  parseDailySessionResponse,
  parseFinalAssessmentResponse,
  parseGoalPmRoutingResponse,
  parseImplementationReadinessResponse,
  parseNeighborhoodTaskUpdatesResponse,
  parsePlanShapingFeatureSyncAnalyzeResponse,
  parsePlanShapingFeatureSyncIterateResponse,
  parseReportUpdateResponse,
  parseRollupProposalResponse,
  parseSetSplittingResponse,
  parseStartupSessionPlanResponse,
  parseVerificationPlanResponse,
} from './response-schemas';

const extractJsonFromFence = (text: string): string | null => {
  // Iterate all fenced code blocks and prefer one whose content contains
  // a "responseType" key — this avoids false-matching on earlier fences
  // (e.g. code examples) that appear before the structured JSON payload.
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fallback: string | null = null;
  for (const match of text.matchAll(fenceRegex)) {
    const content = match[1]?.trim();
    if (!content) continue;
    if (!fallback) fallback = content;
    if (content.includes('"responseType"')) {
      return content;
    }
  }
  return fallback;
};

const extractJsonFromBraces = (text: string): string | null => {
  // Prefer an object whose first key is responseType — this skips stray
  // braces in preamble text (e.g. type annotations like
  // `{ id?, title? }`) even when the response is pretty-printed.
  const responseTypeMatch = /\{\s*"responseType"\s*:/m.exec(text);
  const firstBrace = responseTypeMatch?.index ?? text.indexOf('{');
  if (firstBrace === -1) {
    return null;
  }

  // Stop at the matching closing brace instead of the last brace in the
  // entire response. A postscript may contain its own object-like text, and
  // selecting that final brace makes an otherwise valid envelope unparsable.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(firstBrace, index + 1).trim();
      }
    }
  }

  // Keep the repair path available for a truncated structured response. The
  // caller can pass this best-effort slice through jsonrepair.
  const lastBrace = text.lastIndexOf('}');
  return lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1).trim() : null;
};

export const extractStructuredJsonPayload = (text: string): string | null => {
  const fromFence = extractJsonFromFence(text);
  if (fromFence) {
    return fromFence;
  }

  return extractJsonFromBraces(text);
};

/**
 * Remove the fenced structured-JSON block (the one carrying a `responseType`
 * key) from agent text, leaving the surrounding product-language prose. Used
 * when the visible message is the agent's prose and the fenced JSON is only a
 * machine contract that must not reach the user. Falls back to the first
 * fenced block when none names `responseType`, mirroring `extractJsonFromFence`.
 */
export const stripStructuredJsonBlock = (text: string): string => {
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fallbackMatch: string | null = null;
  for (const match of text.matchAll(fenceRegex)) {
    const content = match[1]?.trim();
    if (!content) continue;
    if (!fallbackMatch) fallbackMatch = match[0];
    if (content.includes('"responseType"')) {
      return text.replace(match[0], '').trim();
    }
  }
  return fallbackMatch ? text.replace(fallbackMatch, '').trim() : text.trim();
};

const tryParseJson = (
  payload: string,
): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    return { ok: true, value: JSON.parse(payload) as unknown };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? `Invalid JSON payload: ${error.message}` : 'Invalid JSON payload',
    };
  }
};

const tryRepairJson = (
  payload: string,
): { ok: true; value: unknown } | { ok: false; error: string } => {
  try {
    const repaired = jsonrepair(payload);
    return { ok: true, value: JSON.parse(repaired) as unknown };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Invalid JSON payload (repair failed): ${error.message}`
          : 'Invalid JSON payload (repair failed)',
    };
  }
};

const parseTextAsJson = (
  text: string,
): { ok: true; value: unknown } | { ok: false; error: string } => {
  // Try fence extraction first, but fall back to brace extraction if the
  // fenced content isn't valid JSON. This handles cases where the JSON
  // contains inner markdown code fences (e.g. ```yaml blocks inside string
  // values), which cause the non-greedy fence regex to match too early.
  const fromFence = extractJsonFromFence(text);
  if (fromFence) {
    const fenceResult = tryParseJson(fromFence);
    if (fenceResult.ok) {
      return fenceResult;
    }
  }

  const fromBraces = extractJsonFromBraces(text);
  if (fromBraces) {
    const braceResult = tryParseJson(fromBraces);
    if (braceResult.ok) {
      return braceResult;
    }

    // Both fence and brace extraction produced invalid JSON — try repairing
    // the brace-extracted payload as a last resort.
    return tryRepairJson(fromBraces);
  }

  return {
    ok: false,
    error: 'No JSON object found in agent response',
  };
};

const createTextParser =
  <T>(schemaParser: (raw: unknown) => ParseResult<T>) =>
  (text: string): ParseResult<T> => {
    const parsedJson = parseTextAsJson(text);
    if (!parsedJson.ok) {
      return parsedJson;
    }
    return schemaParser(parsedJson.value);
  };

export const parseStartupSessionPlanResponseFromText = createTextParser<
  ParseStartupSessionPlanResponseResult extends ParseResult<infer T> ? T : never
>(parseStartupSessionPlanResponse);

export const parseFinalAssessmentResponseFromText = createTextParser<
  ParseFinalAssessmentResponseResult extends ParseResult<infer T> ? T : never
>(parseFinalAssessmentResponse);

export const parseGoalPmRoutingResponseFromText = createTextParser<
  ParseGoalPmRoutingResponseResult extends ParseResult<infer T> ? T : never
>(parseGoalPmRoutingResponse);

export const parseImplementationReadinessResponseFromText = createTextParser<
  ParseImplementationReadinessResponseResult extends ParseResult<infer T> ? T : never
>(parseImplementationReadinessResponse);

export const parseVerificationPlanResponseFromText = createTextParser<
  ParseVerificationPlanResponseResult extends ParseResult<infer T> ? T : never
>(parseVerificationPlanResponse);

export const parseChildTaskDescriptionUpdateResponseFromText = createTextParser<
  ParseChildTaskDescriptionUpdateResponseResult extends ParseResult<infer T> ? T : never
>(parseChildTaskDescriptionUpdateResponse);

export const parseNeighborhoodTaskUpdatesResponseFromText = createTextParser<
  ParseNeighborhoodTaskUpdatesResponseResult extends ParseResult<infer T> ? T : never
>(parseNeighborhoodTaskUpdatesResponse);

export const parseSetSplittingResponseFromText =
  createTextParser<ParseSetSplittingResponseResult extends ParseResult<infer T> ? T : never>(
    parseSetSplittingResponse,
  );

export const parseRollupProposalResponseFromText = createTextParser<
  ParseRollupProposalResponseResult extends ParseResult<infer T> ? T : never
>(parseRollupProposalResponse);

export const parseRefinerResponse = (text: string): string | null => {
  const payload = extractStructuredJsonPayload(text);
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const response = typeof obj['response'] === 'string' ? obj['response'].trim() : null;
  return response && response.length > 0 ? response : null;
};

export const parseDailySessionResponseFromText =
  createTextParser<ParseDailySessionResponseResult extends ParseResult<infer T> ? T : never>(
    parseDailySessionResponse,
  );

export const parseReportUpdateResponseFromText =
  createTextParser<ParseReportUpdateResponseResult extends ParseResult<infer T> ? T : never>(
    parseReportUpdateResponse,
  );

export const parseAgentSearchResultsResponseFromText = createTextParser<
  ParseAgentSearchResultsResponseResult extends ParseResult<infer T> ? T : never
>(parseAgentSearchResultsResponse);

export const parsePlanShapingFeatureSyncAnalyzeResponseFromText = createTextParser<
  ParsePlanShapingFeatureSyncAnalyzeResponseResult extends ParseResult<infer T> ? T : never
>(parsePlanShapingFeatureSyncAnalyzeResponse);

export const parsePlanShapingFeatureSyncIterateResponseFromText = createTextParser<
  ParsePlanShapingFeatureSyncIterateResponseResult extends ParseResult<infer T> ? T : never
>(parsePlanShapingFeatureSyncIterateResponse);
