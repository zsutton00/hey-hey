import type { JsonValue } from '../../../durable-data';

/** Existing inputs remain unchanged; v14 admits CLI-owned onboarding runs. */
export function migrateSessionFileV13ToV14(file: JsonValue): JsonValue {
  return file;
}
