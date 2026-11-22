import type { JsonValue } from '../../../durable-data';

/** Existing inputs remain unchanged; v15 lets a start_run carry where each Service works. */
export function migrateSessionFileV14ToV15(file: JsonValue): JsonValue {
  return file;
}
