import type { JsonObject, JsonValue } from './session';

/** Keys whose value names the entity a result entry is about, or the far end of a link. */
const IDENTITY_KEYS = [
  'id',
  'entityId',
  'sourceId',
  'targetId',
  'sourceEntityId',
  'targetEntityId',
  'fromId',
  'toId',
] as const;

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether any string anywhere in a tool call's arguments names a hidden entity. */
export const mentionsHiddenEntity = (value: JsonValue, hidden: ReadonlySet<string>): boolean => {
  if (typeof value === 'string') {
    return hidden.has(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => mentionsHiddenEntity(entry, hidden));
  }
  if (isJsonObject(value)) {
    return Object.values(value).some((entry) => mentionsHiddenEntity(entry, hidden));
  }

  return false;
};

const namesHiddenEntity = (entry: JsonObject, hidden: ReadonlySet<string>): boolean => {
  const namedDirectly = IDENTITY_KEYS.some((key) => {
    const id = entry[key];
    return typeof id === 'string' && hidden.has(id);
  });
  if (namedDirectly) {
    return true;
  }

  // A `get_edges` edge names its far end inside `otherEndpoint`.
  const otherEndpoint = entry['otherEndpoint'];
  return isJsonObject(otherEndpoint) && namesHiddenEntity(otherEndpoint, hidden);
};

/** Drops every list entry, and every entry of an ID-keyed map, that names a hidden entity. */
const withoutHiddenEntries = (value: JsonValue, hidden: ReadonlySet<string>): JsonValue => {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => !(isJsonObject(entry) && namesHiddenEntity(entry, hidden)))
      .map((entry) => withoutHiddenEntries(entry, hidden));
  }
  if (!isJsonObject(value)) {
    return value;
  }

  const kept = Object.entries(value).filter(([key]) => !hidden.has(key));
  return Object.fromEntries(kept.map(([key, entry]) => [key, withoutHiddenEntries(entry, hidden)]));
};

const parseJson = (text: string): JsonValue | undefined => {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
};

/**
 * Removes hidden entities from an MCP tool result: structured content, and any text block that
 * holds JSON. Plain-text blocks are passed through unchanged.
 */
export const withoutHiddenEntities = (
  result: JsonValue,
  hidden: ReadonlySet<string>,
): JsonValue => {
  if (!isJsonObject(result)) {
    return result;
  }

  const content = result['content'];
  const filteredContent = Array.isArray(content)
    ? content.map((block) => {
        if (!isJsonObject(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') {
          return block;
        }
        const parsed = parseJson(block['text']);
        if (parsed === undefined) {
          return block;
        }
        return { ...block, text: JSON.stringify(withoutHiddenEntries(parsed, hidden)) };
      })
    : content;

  const structured = result['structuredContent'];
  return {
    ...result,
    ...(filteredContent === undefined ? {} : { content: filteredContent }),
    ...(structured === undefined
      ? {}
      : { structuredContent: withoutHiddenEntries(structured, hidden) }),
  };
};
