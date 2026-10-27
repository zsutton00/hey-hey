import { z } from 'zod/v4';
import type { JsonValue } from '../../durable-data';
import {
  INPUT_QUEUE_SCHEMA_VERSION_V12,
  decodeStoredRecordV12,
  type FinishedInputRecordV12,
  type OpenInputRecordV12,
  type ReadableInputRecordV12,
  type RecordDecodeV12,
  type StoredInputKindV12,
  type StoredPayloadV12,
  storedPayloadV12Schemas,
} from './storage-schema/v12';

/** The storage version this build writes; older files migrate to it when opened. */
export const INPUT_QUEUE_SCHEMA_VERSION = INPUT_QUEUE_SCHEMA_VERSION_V12;
export const decodeStoredRecord: (value: JsonValue) => RecordDecodeV12 = decodeStoredRecordV12;

export type ReadableInputRecord = ReadableInputRecordV12;
export type OpenInputRecord = OpenInputRecordV12;
type FinishedInputRecord = FinishedInputRecordV12;
export type StoredInputKind = StoredInputKindV12;
type StoredPayload = StoredPayloadV12;
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
  ({ kind, keyKind, payload: storedPayloadV12Schemas[kind].parse(payload) }) as StoredInput;

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
