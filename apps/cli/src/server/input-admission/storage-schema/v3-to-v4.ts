import type { JsonValue } from '../../../durable-data';

/** v4 only adds the `verify_feature` prompt type, so every v3 record is already a valid v4 record. */
export function migrateSessionFileV3ToV4(file: JsonValue): JsonValue {
  return file;
}
