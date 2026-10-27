import type { JsonValue } from '../../../durable-data';

/** Existing records retain their data. Inputs without created Feature IDs are quarantined by the v12 decoder. */
export function migrateSessionFileV11ToV12(file: JsonValue): JsonValue {
  return file;
}
