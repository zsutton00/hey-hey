import type { JsonValue } from '../../../durable-data';

/** v9 cannot invent missing Plan seed identities. The reader quarantines only open inputs
 * lacking them; finished payloads and signed history remain unchanged. */
export function migrateSessionFileV8ToV9(file: JsonValue): JsonValue {
  return file;
}
