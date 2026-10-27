import type { JsonValue } from '../../../durable-data';

/** v11 adds an optional finish choice and removes round limits. v10 inputs remain readable. */
export function migrateSessionFileV10ToV11(file: JsonValue): JsonValue {
  return file;
}
