import type { JsonValue } from '../../../durable-data';

/** v10 only stops rejecting the contract's object-shaped repository enrichment candidates.
 * v9 could never admit one, so every v9 record is already a valid v10 record. */
export function migrateSessionFileV9ToV10(file: JsonValue): JsonValue {
  return file;
}
