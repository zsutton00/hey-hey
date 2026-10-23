import type { OpenItemsOperation } from "./openItemsAdapter";
import {
  validOpenItemsActivation,
  validOpenItemsCollection,
  validOpenItemsNote,
  validOpenItemsPin,
  validOpenItemsRef,
} from "./openItemsValidation";
import { readOpenItemsBrowserRecord } from "./openItemsBrowserRecord";

export function parseOpenItemsJson(value: string | null): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}
const objectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function readOpenItemsCache(value: string | null) {
  const parsed = parseOpenItemsJson(value);
  if (
    !objectRecord(parsed) ||
    parsed.version !== 2 ||
    !validOpenItemsCollection(parsed.collection)
  )
    return null;
  return {
    collection: parsed.collection,
    preferences: readOpenItemsBrowserRecord(JSON.stringify(parsed.preferences)),
  };
}

function retryOperation(value: unknown): OpenItemsOperation | null {
  if (!objectRecord(value) || !objectRecord(value.parameters)) return null;
  const p = value.parameters;
  if (
    value.kind === "activateOpenItem" &&
    validOpenItemsActivation(p.activateOpenItemRequest)
  )
    return {
      kind: value.kind,
      parameters: { activateOpenItemRequest: p.activateOpenItemRequest },
    };
  const ref = { entityType: p.entityType, entityId: p.entityId };
  if (!validOpenItemsRef(ref)) return null;
  if (
    value.kind === "setOpenItemNote" &&
    validOpenItemsNote(p.setOpenItemNoteRequest)
  )
    return {
      kind: value.kind,
      parameters: { ...ref, setOpenItemNoteRequest: p.setOpenItemNoteRequest },
    };
  if (
    value.kind === "setOpenItemPin" &&
    validOpenItemsPin(p.setOpenItemPinRequest)
  )
    return {
      kind: value.kind,
      parameters: { ...ref, setOpenItemPinRequest: p.setOpenItemPinRequest },
    };
  return null;
}

export function readOpenItemsQueue(value: string | null): OpenItemsOperation[] {
  const parsed = parseOpenItemsJson(value);
  if (
    !objectRecord(parsed) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.operations)
  )
    return [];
  return parsed.operations.slice(0, 1000).flatMap((entry: unknown) => {
    const operation = retryOperation(entry);
    return operation ? [operation] : [];
  });
}
