import { z } from 'zod/v4';
import type { JsonValue } from '../../durable-data';
import {
  INPUT_QUEUE_SCHEMA_VERSION_V7,
  decodeStoredRecordV7,
  type FinishedInputRecordV7,
  type OpenInputRecordV7,
  type ReadableInputRecordV7,
  type RecordDecodeV7,
  type StoredInputKindV7,
  type StoredPayloadV7,
  storedPayloadV7Schemas,
} from './storage-schema/v7';

/** The storage version this build writes; older files migrate to it when opened. */
export const INPUT_QUEUE_SCHEMA_VERSION = INPUT_QUEUE_SCHEMA_VERSION_V7;
export const decodeStoredRecord: (value: JsonValue) => RecordDecodeV7 = decodeStoredRecordV7;

export type ReadableInputRecord = ReadableInputRecordV7;
export type OpenInputRecord = OpenInputRecordV7;
type FinishedInputRecord = FinishedInputRecordV7;
export type StoredInputKind = StoredInputKindV7;
type StoredPayload = StoredPayloadV7;
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
  ({ kind, keyKind, payload: storedPayloadV7Schemas[kind].parse(payload) }) as StoredInput;

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
