import type { SystemMessageData, UserMessageData } from "../api";

const USER_MESSAGE_METADATA_KEYS = new Set(["source", "responseType"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readTrimmedString = (
  record: Record<string, unknown>,
  key: string
): string => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

const isMeaningfulNonStringValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  return isRecord(value) && Object.keys(value).length > 0;
};

const readSingleFieldUserText = (
  data: Record<string, unknown>
): string | null => {
  const entries = Object.entries(data).filter(
    ([key]) =>
      key !== "comment" &&
      key !== "text" &&
      !USER_MESSAGE_METADATA_KEYS.has(key)
  );
  const textEntries = entries.filter(
    ([, value]) => typeof value === "string" && value.trim().length > 0
  );
  if (textEntries.length !== 1) return null;

  const [selectedKey, selectedValue] = textEntries[0];
  if (typeof selectedValue !== "string") return null;
  const hasOtherMeaningfulValues = entries.some(
    ([key, value]) => key !== selectedKey && isMeaningfulNonStringValue(value)
  );
  return hasOtherMeaningfulValues ? null : selectedValue.trim();
};

/** Returns only the canonical textual USER payload rendered by the conversation. */
export const readUserMessageDisplayText = (
  data: UserMessageData
): string | null => {
  if (!isRecord(data)) return null;

  const comment = readTrimmedString(data, "comment");
  if (comment) return comment;

  const text = readTrimmedString(data, "text");
  if (text) return text;

  const agentInput = data.agentInput;
  if (isRecord(agentInput)) {
    const userMessage = readTrimmedString(agentInput, "userMessage");
    if (userMessage) return userMessage;
  }

  return readSingleFieldUserText(data);
};

/** Returns the canonical textual SYSTEM response rendered by the conversation. */
export const readSystemMessageDisplayText = (
  data: SystemMessageData
): string | null => {
  const response: unknown = data.response;
  if (typeof response === "string") return response;
  if (!isRecord(response)) return null;

  for (const key of ["feedback", "message", "text"] as const) {
    if (key in response) {
      const value = response[key];
      return typeof value === "string" ? value : null;
    }
  }
  return null;
};
