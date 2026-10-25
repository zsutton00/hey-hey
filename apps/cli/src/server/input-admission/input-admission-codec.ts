import { z } from 'zod/v4';
import type { JsonValue } from '../../durable-data';
import {
  INPUT_QUEUE_SCHEMA_VERSION_V9,
  decodeStoredRecordV9,
  type FinishedInputRecordV9,
  type OpenInputRecordV9,
  type ReadableInputRecordV9,
  type RecordDecodeV9,
  type StoredInputKindV9,
  type StoredPayloadV9,
  storedPayloadV9Schemas,
} from './storage-schema/v9';

/** The storage version this build writes; older files migrate to it when opened. */
export const INPUT_QUEUE_SCHEMA_VERSION = INPUT_QUEUE_SCHEMA_VERSION_V9;
export const decodeStoredRecord: (value: JsonValue) => RecordDecodeV9 = decodeStoredRecordV9;

export type ReadableInputRecord = ReadableInputRecordV9;
export type OpenInputRecord = OpenInputRecordV9;
type FinishedInputRecord = FinishedInputRecordV9;
export type StoredInputKind = StoredInputKindV9;
type StoredPayload = StoredPayloadV9;
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
  ({ kind, keyKind, payload: storedPayloadV9Schemas[kind].parse(payload) }) as StoredInput;

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
