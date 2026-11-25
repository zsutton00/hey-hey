import { z } from 'zod/v4';
import type { JsonValue } from '../../durable-data';
import {
  INPUT_QUEUE_SCHEMA_VERSION_V17,
  decodeStoredRecordV17,
  type FinishedInputRecordV17,
  type OpenInputRecordV17,
  type ReadableInputRecordV17,
  type RecordDecodeV17,
  type StoredInputKindV17,
  type StoredPayloadV17,
  storedPayloadV17Schemas,
} from './storage-schema/v17';

// The frozen v17 `Exact<T>` helper recursively expands string-brand intersections as objects.
// Restore their nominal string shape at the active codec boundary without changing v17 data.
type RestoreBrandedStrings<T> = T extends { __brand: infer Brand extends string }
  ? string & { readonly __brand: Brand }
  : T extends ReadonlySet<unknown> | ReadonlyMap<unknown, unknown>
    ? T
    : T extends readonly (infer U)[]
      ? RestoreBrandedStrings<U>[]
      : T extends object
        ? { [K in keyof T]: RestoreBrandedStrings<T[K]> }
        : T;
const restoreBrandedStrings = <T>(value: T): RestoreBrandedStrings<T> =>
  value as RestoreBrandedStrings<T>;

/** The storage version this build writes; older files migrate to it when opened. */
export const INPUT_QUEUE_SCHEMA_VERSION = INPUT_QUEUE_SCHEMA_VERSION_V17;

export type ReadableInputRecord = RestoreBrandedStrings<ReadableInputRecordV17>;
export type OpenInputRecord = RestoreBrandedStrings<OpenInputRecordV17>;
type FinishedInputRecord = FinishedInputRecordV17;
export type StoredInputKind = StoredInputKindV17;
type StoredPayload = StoredPayloadV17;
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
type StoredInputV17 = {
  [K in StoredInputKind]: {
    kind: K;
    keyKind: ReadableInputRecord['keyKind'];
    payload: StoredPayload[K];
  };
}[StoredInputKind];
export type StoredInput = RestoreBrandedStrings<StoredInputV17>;

type RestoredRecordDecode =
  | Exclude<RecordDecodeV17, { status: 'readable' }>
  | { status: 'readable'; record: ReadableInputRecord };

/** Decode with the frozen schema, then undo only its type-level expansion of branded strings. */
export const decodeStoredRecord = (value: JsonValue): RestoredRecordDecode => {
  const decoded = decodeStoredRecordV17(value);
  if (decoded.status !== 'readable') return decoded;
  return { status: 'readable', record: restoreBrandedStrings(decoded.record) };
};

/** Parses an in-process producer's payload into the storage shape of `kind`. */
export const storedInput = (
  kind: StoredInputKind,
  keyKind: ReadableInputRecord['keyKind'],
  payload: unknown,
): StoredInput =>
  restoreBrandedStrings({
    kind,
    keyKind,
    payload: storedPayloadV17Schemas[kind].parse(payload),
  }) as StoredInput;

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
