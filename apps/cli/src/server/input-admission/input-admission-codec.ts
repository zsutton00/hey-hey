import { z } from 'zod/v4';
import type { JsonValue } from '../../durable-data';
import {
  INPUT_QUEUE_SCHEMA_VERSION_V10,
  decodeStoredRecordV10,
  type FinishedInputRecordV10,
  type OpenInputRecordV10,
  type ReadableInputRecordV10,
  type RecordDecodeV10,
  type StoredInputKindV10,
  type StoredPayloadV10,
  storedPayloadV10Schemas,
} from './storage-schema/v10';

/** The storage version this build writes; older files migrate to it when opened. */
export const INPUT_QUEUE_SCHEMA_VERSION = INPUT_QUEUE_SCHEMA_VERSION_V10;
export const decodeStoredRecord: (value: JsonValue) => RecordDecodeV10 = decodeStoredRecordV10;

export type ReadableInputRecord = ReadableInputRecordV10;
export type OpenInputRecord = OpenInputRecordV10;
type FinishedInputRecord = FinishedInputRecordV10;
export type StoredInputKind = StoredInputKindV10;
type StoredPayload = StoredPayloadV10;
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
  ({ kind, keyKind, payload: storedPayloadV10Schemas[kind].parse(payload) }) as StoredInput;

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
