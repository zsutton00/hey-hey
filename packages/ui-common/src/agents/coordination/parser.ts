import {
  parseFinalAssessmentResponse,
  parseSetSplittingResponse,
  parseStartupSessionPlanResponse,
  parseVerificationPlanResponse,
} from "./schemas";
import type {
  ParseFinalAssessmentResponseResult,
  ParseSetSplittingResponseResult,
  ParseStartupSessionPlanResponseResult,
  ParseVerificationPlanResponseResult,
} from "./schemas";

const extractJsonFromFence = (text: string): string | null => {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!fenceMatch || !fenceMatch[1]) {
    return null;
  }

  return fenceMatch[1].trim();
};

const extractJsonFromBraces = (text: string): string | null => {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1).trim();
};

export const extractStructuredJsonPayload = (text: string): string | null => {
  const fromFence = extractJsonFromFence(text);
  if (fromFence) {
    return fromFence;
  }

  return extractJsonFromBraces(text);
};

const parseTextAsJson = (
  text: string
): { ok: true; value: unknown } | { ok: false; error: string } => {
  const payload = extractStructuredJsonPayload(text);
  if (!payload) {
    return {
      ok: false,
      error: "No JSON object found in agent response",
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(payload) as unknown,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `Invalid JSON payload: ${error.message}`
          : "Invalid JSON payload",
    };
  }
};

export const parseStartupSessionPlanResponseFromText = (
  text: string
): ParseStartupSessionPlanResponseResult => {
  const parsedJson = parseTextAsJson(text);
  if (!parsedJson.ok) {
    return parsedJson;
  }

  return parseStartupSessionPlanResponse(parsedJson.value);
};

export const parseFinalAssessmentResponseFromText = (
  text: string
): ParseFinalAssessmentResponseResult => {
  const parsedJson = parseTextAsJson(text);
  if (!parsedJson.ok) {
    return parsedJson;
  }

  return parseFinalAssessmentResponse(parsedJson.value);
};

export const parseVerificationPlanResponseFromText = (
  text: string
): ParseVerificationPlanResponseResult => {
  const parsedJson = parseTextAsJson(text);
  if (!parsedJson.ok) {
    return parsedJson;
  }

  return parseVerificationPlanResponse(parsedJson.value);
};

export const parseSetSplittingResponseFromText = (
  text: string
): ParseSetSplittingResponseResult => {
  const parsedJson = parseTextAsJson(text);
  if (!parsedJson.ok) {
    return parsedJson;
  }

  return parseSetSplittingResponse(parsedJson.value);
};
