const RESPONSE_TYPE_PATTERN = /^([a-z][a-z0-9_]*)_v([1-9][0-9]*)$/;

export interface StructuredResponseContract {
  type: string;
  version: number;
}

export interface StructuredResponse {
  value: Record<string, unknown>;
  contract: StructuredResponseContract | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractJsonFromFence = (text: string): string | null => {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
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
  const fencedPayload = extractJsonFromFence(text);
  if (fencedPayload) {
    return fencedPayload;
  }

  return extractJsonFromBraces(text);
};

const readContractFromResponseType = (
  value: Record<string, unknown>
): StructuredResponseContract | null => {
  const responseType = readNonEmptyString(value["responseType"]);
  if (!responseType) {
    return null;
  }

  const match = RESPONSE_TYPE_PATTERN.exec(responseType);
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  return {
    type: match[1],
    version: Number.parseInt(match[2], 10),
  };
};

const readContractFromTypeVersion = (
  value: Record<string, unknown>
): StructuredResponseContract | null => {
  const type = readNonEmptyString(value["type"]);
  const version = value["version"];
  if (
    !type ||
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return null;
  }

  return {
    type,
    version,
  };
};

export const readStructuredResponseContract = (
  value: Record<string, unknown>
): StructuredResponseContract | null =>
  readContractFromTypeVersion(value) ?? readContractFromResponseType(value);

export const parseStructuredResponseFromText = (
  text: string
): StructuredResponse | null => {
  const payload = extractStructuredJsonPayload(text);
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload);
    if (!isRecord(parsed)) {
      return null;
    }

    return {
      value: parsed,
      contract: readStructuredResponseContract(parsed),
    };
  } catch {
    return null;
  }
};
