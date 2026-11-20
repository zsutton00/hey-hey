import type { JsonValue } from '../../../durable-data';

/** Existing inputs remain unchanged; v16 admits Antigravity provider ids. */
export function migrateSessionFileV15ToV16(file: JsonValue): JsonValue {
  return file;
}
