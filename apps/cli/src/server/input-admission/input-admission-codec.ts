import { z } from 'zod/v4';
import type { JsonValue } from '../../durable-data';
import {
  INPUT_QUEUE_SCHEMA_VERSION_V8,
  decodeStoredRecordV8,
  type FinishedInputRecordV8,
  type OpenInputRecordV8,
  type ReadableInputRecordV8,
  type RecordDecodeV8,
  type StoredInputKindV8,
  type StoredPayloadV8,
  storedPayloadV8Schemas,
} from './storage-schema/v8';

/** The storage version this build writes; older files migrate to it when opened. */
export const INPUT_QUEUE_SCHEMA_VERSION = INPUT_QUEUE_SCHEMA_VERSION_V8;
export const decodeStoredRecord: (value: JsonValue) => RecordDecodeV8 = decodeStoredRecordV8;

export type ReadableInputRecord = ReadableInputRecordV8;
export type OpenInputRecord = OpenInputRecordV8;
type FinishedInputRecord = FinishedInputRecordV8;
export type StoredInputKind = StoredInputKindV8;
type StoredPayload = StoredPayloadV8;
export type InputIdentity = Pick<
  ReadableInputRecord,
  | 'key'
  | 'fingerprint'
  | 'agentSessionId'
  | 'runId'
  | 'organizationId'
  | 'projectId'
  | 'machineId'
  | 'userId'
  | 'messageId'
>;

/** A new input in its storage shape, classified once by whoever admitted it. */
export type StoredInput = {
  [K in StoredInputKind]: {
    kind: K;
    keyKind: ReadableInputRecord['keyKind'];
    payload: StoredPayload[K];
  };
}[StoredInputKind];

/** Parses an in-process producer's payload into the storage shape of `kind`. */
export const storedInput = (
  kind: StoredInputKind,
  keyKind: ReadableInputRecord['keyKind'],
  payload: unknown,
): StoredInput =>
  // JSON-shaped input has no explicit `undefined`, so the exact-optional view is sound.
  ({ kind, keyKind, payload: storedPayloadV8Schemas[kind].parse(payload) }) as StoredInput;

/** Any record about to be committed; `save` decodes it back into a readable record. */
export type InputRecordDraft = Omit<ReadableInputRecord, 'kind' | 'payload'> & {
  kind: StoredInputKind | null;
  payload: unknown;
};

/** A stored record this build cannot read, retained byte-for-byte and never executed. */
export const quarantinedRecordSchema = z.strictObject({
  key: z.string().nullable(),
  reason: z.string(),
  /** The schemaVersion of the file the record was read from. */
  sourceSchemaVersion: z.number().int().positive(),
  raw: z.json(),
});
export type QuarantinedRecord = z.infer<typeof quarantinedRecordSchema>;
