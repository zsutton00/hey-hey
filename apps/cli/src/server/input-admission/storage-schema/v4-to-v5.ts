import type { JsonValue } from '../../../durable-data';

/** v5 only widens the stored reasoning efforts, so every v4 record is already a valid v5 record. */
export function migrateSessionFileV4ToV5(file: JsonValue): JsonValue {
  return file;
}
