import type { JsonValue } from '../../../durable-data';

/** v8 adds optional approved Markdown handoff fields; v7 inputs need no rewriting. */
export function migrateSessionFileV7ToV8(file: JsonValue): JsonValue {
  return file;
}
