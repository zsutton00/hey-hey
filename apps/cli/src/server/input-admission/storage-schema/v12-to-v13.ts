import type { JsonValue } from '../../../durable-data';

/** Existing records retain their data; v13 only adds optional Coding Plan discrepancies to Implement. */
export function migrateSessionFileV12ToV13(file: JsonValue): JsonValue {
  return file;
}
