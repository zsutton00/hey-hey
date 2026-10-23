import type { JsonValue } from '../../../durable-data';

/**
 * v6 adds the approved visuals to stored plan-shaping phase-breakdown and step-review triggers.
 * There is no safe list to invent, so an open v5 record of either kind loads quarantined.
 */
export function migrateSessionFileV5ToV6(file: JsonValue): JsonValue {
  return file;
}
