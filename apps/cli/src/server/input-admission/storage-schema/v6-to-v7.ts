import type { JsonValue } from '../../../durable-data';

/**
 * v7 lets a stored start_run carry the Shared Browser tab the user opened before the Run
 * existed. The field is optional and a v6 record never had one, so it reads as none.
 */
export function migrateSessionFileV6ToV7(file: JsonValue): JsonValue {
  return file;
}
