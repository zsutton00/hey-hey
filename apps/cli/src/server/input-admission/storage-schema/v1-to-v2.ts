/**
 * FROZEN: migrates an input queue session file from schemaVersion 1 to 2.
 *
 * v1 stored each record's raw signed frame and classified it by which wire schema it happened
 * to parse against. This is the only place that shape classification still exists: it stamps
 * `kind` and `keyKind` once, from the v1 shape, so nothing downstream sniffs payloads again.
 * Frames become `{ conversationId, signedEvent, event }`, `user_message` events gain the
 * `attachments: []` they predate, and records written before admission recorded a disposition
 * were admitted to wait. Nothing else changes.
 *
 * A record that cannot be migrated, or does not decode as v2 afterwards, is kept byte-for-byte
 * in `quarantined` with the reason. Nothing is invented for it.
 */
import { z } from 'zod/v4';
import type { JsonValue } from '../../../durable-data';
import { decodeStoredRecordV2 } from './v2';

type JsonObject = Record<string, JsonValue>;
const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const v1FileSchema = z.strictObject({ records: z.array(z.json()) });

type Migrated = { ok: true; record: JsonObject } | { ok: false; reason: string };

const migrateFrame = (frame: JsonObject): Migrated | { ok: true; fields: JsonObject } => {
  const envelope = frame['envelope'];
  const event = isObject(envelope) ? envelope['event'] : undefined;
  if (!isObject(event) || typeof event['promptType'] !== 'string')
    return { ok: false, reason: 'v1 trigger frame has no signed event.' };
  const payload = event['payload'];
  const migratedEvent =
    event['promptType'] === 'user_message' && isObject(payload) && !('attachments' in payload)
      ? { ...event, payload: { ...payload, attachments: [] } }
      : event;
  const operation =
    event['promptType'] === 'start_run' ||
    event['promptType'] === 'user_message' ||
    isObject(event['inputExecution']);
  return {
    ok: true,
    fields: {
      kind: 'trigger_frame',
      keyKind: operation ? 'operation' : 'trigger_message',
      payload: {
        conversationId:
          typeof frame['conversationId'] === 'string' ? frame['conversationId'] : null,
        signedEvent: event,
        event: migratedEvent,
      },
    },
  };
};

const migrateRecord = (raw: JsonValue): Migrated => {
  if (!isObject(raw) || !('payload' in raw))
    return { ok: false, reason: 'v1 record is not an object with a payload.' };
  const payload = raw['payload'];
  let fields: JsonObject;
  if (payload === null) {
    fields = { kind: null, keyKind: 'operation', payload: null };
  } else if (isObject(payload) && 'envelope' in payload) {
    const frame = migrateFrame(payload);
    if (!('fields' in frame)) return frame;
    fields = frame.fields;
  } else if (
    isObject(payload) &&
    (payload['kind'] === 'session_message' || payload['kind'] === 'run_follow_up')
  ) {
    fields = { kind: payload['kind'], keyKind: 'operation', payload };
  } else {
    return { ok: false, reason: 'v1 payload is not a frame, collaboration or Run follow-up.' };
  }
  return {
    ok: true,
    record: { ...raw, admissionDisposition: raw['admissionDisposition'] ?? 'queued', ...fields },
  };
};

const quarantine = (raw: JsonValue, reason: string): JsonValue => ({
  key: isObject(raw) && typeof raw['key'] === 'string' ? raw['key'] : null,
  reason,
  sourceSchemaVersion: 1,
  raw,
});

export function migrateSessionFileV1ToV2(file: JsonValue): JsonValue {
  const { records } = v1FileSchema.parse(file);
  const migrated: JsonValue[] = [];
  const quarantined: JsonValue[] = [];
  for (const raw of records) {
    const result = migrateRecord(raw);
    if (result.ok) {
      const decoded = decodeStoredRecordV2(result.record);
      if (decoded.status === 'readable') {
        migrated.push(result.record);
        continue;
      }
      quarantined.push(quarantine(raw, decoded.reason));
    } else {
      quarantined.push(quarantine(raw, result.reason));
    }
  }
  return { records: migrated, quarantined };
}
