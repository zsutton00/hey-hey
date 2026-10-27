import { inputQueueV12Schemas } from './storage-schema/v12';
import { migrateSessionFileV11ToV12 } from './storage-schema/v11-to-v12';
import { inputQueueV11Schemas } from './storage-schema/v11';
import { migrateSessionFileV10ToV11 } from './storage-schema/v10-to-v11';
import { inputQueueV9Schemas } from './storage-schema/v9';
import { migrateSessionFileV8ToV9 } from './storage-schema/v8-to-v9';
import { inputQueueV10Schemas } from './storage-schema/v10';
import { migrateSessionFileV9ToV10 } from './storage-schema/v9-to-v10';
import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import type { JsonValue } from '../../durable-data';
import { canonicalizeJson } from '../trigger-verification/jcs';
import { migrateSessionFileV1ToV2 } from './storage-schema/v1-to-v2';
import { inputQueueV2Schemas } from './storage-schema/v2';
import { inputQueueV3Schemas } from './storage-schema/v3';
import { inputQueueV4Schemas } from './storage-schema/v4';
import { inputQueueV5Schemas } from './storage-schema/v5';
import { inputQueueV6Schemas } from './storage-schema/v6';
import { inputQueueV8Schemas } from './storage-schema/v8';
import { migrateSessionFileV7ToV8 } from './storage-schema/v7-to-v8';
import { inputQueueV7Schemas } from './storage-schema/v7';
import { migrateSessionFileV2ToV3 } from './storage-schema/v2-to-v3';
import { migrateSessionFileV3ToV4 } from './storage-schema/v3-to-v4';
import { migrateSessionFileV4ToV5 } from './storage-schema/v4-to-v5';
import { migrateSessionFileV5ToV6 } from './storage-schema/v5-to-v6';
import { migrateSessionFileV6ToV7 } from './storage-schema/v6-to-v7';

/** `migrations.get(n)` turns a version-n session file body into a version n+1 body. */
export const INPUT_QUEUE_MIGRATIONS: ReadonlyMap<number, (body: JsonValue) => JsonValue> = new Map([
  [1, migrateSessionFileV1ToV2],
  [2, migrateSessionFileV2ToV3],
  [3, migrateSessionFileV3ToV4],
  [4, migrateSessionFileV4ToV5],
  [5, migrateSessionFileV5ToV6],
  [6, migrateSessionFileV6ToV7],
  [7, migrateSessionFileV7ToV8],
  [8, migrateSessionFileV8ToV9],
  [9, migrateSessionFileV9ToV10],
  [10, migrateSessionFileV10ToV11],
  [11, migrateSessionFileV11ToV12],
]);

/** SHA-256 of the canonical JSON Schema of every schema that reads one stored version. */
export const inputQueueSchemaFingerprint = (schemas: Record<string, z.ZodType>): string =>
  createHash('sha256')
    .update(
      canonicalizeJson(z.toJSONSchema(z.object(schemas), { unrepresentable: 'any', io: 'input' })),
    )
    .digest('hex');

export interface ShippedInputQueueVersion {
  readonly schemaVersion: number;
  /** Session files exactly as this version wrote them; required once a newer version ships. */
  readonly fixture: string | null;
  /** Keys in `fixture` with no defined migration, which must load quarantined. */
  readonly expectedQuarantinedKeys: readonly string[];
  /** The frozen schemas that read this version, or null for a version that predates them. */
  readonly schemas: Record<string, z.ZodType> | null;
  readonly fingerprint: string | null;
}

/**
 * Every input queue storage version a CLI release has written, oldest first. The last entry
 * is the version this build writes. Shipping a new version means appending it here with its
 * frozen schemas and fingerprint, registering the migration from the previous version, and
 * committing a fixture the previous version wrote.
 */
export const SHIPPED_INPUT_QUEUE_VERSIONS: readonly ShippedInputQueueVersion[] = [
  {
    schemaVersion: 1,
    fixture: '__fixtures__/input-queue-v1.json',
    // The open plan-shaping feature-sync iterate input that never carried discrepancies or
    // decisions; there is no safe value to invent for either. Its finished siblings load.
    expectedQuarantinedKeys: ['00000000-0000-4000-8000-000000000197'],
    schemas: null,
    fingerprint: null,
  },
  {
    schemaVersion: 2,
    fixture: '__fixtures__/input-queue-v2.json',
    expectedQuarantinedKeys: [],
    schemas: inputQueueV2Schemas,
    fingerprint: '4ec13d6f5b06272a851f3d70d4309dfb1be6ba7cd92ccae0e221ab6ebe52518d',
  },
  {
    schemaVersion: 3,
    fixture: '__fixtures__/input-queue-v3.json',
    expectedQuarantinedKeys: [],
    schemas: inputQueueV3Schemas,
    fingerprint: '81689f5026022fb71aaaf92ed3f24f3b7db13f7911d3912daf2f5da40f12cc0a',
  },
  {
    schemaVersion: 4,
    fixture: '__fixtures__/input-queue-v4.json',
    expectedQuarantinedKeys: [],
    schemas: inputQueueV4Schemas,
    fingerprint: '818100d5ccd95018538c53bf8872d84e0f8303046ddb286ac0a398a124bf151c',
  },
  {
    schemaVersion: 5,
    fixture: '__fixtures__/input-queue-v5.json',
    expectedQuarantinedKeys: [],
    schemas: inputQueueV5Schemas,
    fingerprint: 'a9d2ef1e0a7ebd4b5d9218c91a5e7fd51cab8ba296e13a15d5ef130e25ca5288',
  },
  {
    schemaVersion: 6,
    fixture: '__fixtures__/input-queue-v6.json',
    expectedQuarantinedKeys: [],
    schemas: inputQueueV6Schemas,
    fingerprint: 'ffeb142007674ee9689f914cbe37ddcb2b8c5aebae84e6a4cfd562a24b775831',
  },
  {
    schemaVersion: 7,
    fixture: '__fixtures__/input-queue-v7.json',
    expectedQuarantinedKeys: [],
    schemas: inputQueueV7Schemas,
    fingerprint: '44d03469d3827091cb9be6d43e6de3b2ab9eabb4134bb1571a659f8c63bb99d0',
  },
  {
    schemaVersion: 8,
    fixture: '__fixtures__/input-queue-v8.json',
    expectedQuarantinedKeys: [],
    schemas: inputQueueV8Schemas,
    fingerprint: 'c712944bcb46840fc0d937eabf25ec1e9d7618d466a30b67a887b1f4129222a0',
  },
  {
    schemaVersion: 9,
    fixture: '__fixtures__/input-queue-v9.json',
    expectedQuarantinedKeys: [],
    schemas: inputQueueV9Schemas,
    fingerprint: 'b011c919e4c486ea8c7ed6b7d69aaec0ac98effe510ea2cf807c80cef3c7bed6',
  },
  {
    schemaVersion: 10,
    fixture: '__fixtures__/input-queue-v10.json',
    expectedQuarantinedKeys: ['00000000-0000-4000-8000-000000000020'],
    schemas: inputQueueV10Schemas,
    fingerprint: 'b011c919e4c486ea8c7ed6b7d69aaec0ac98effe510ea2cf807c80cef3c7bed6',
  },
  {
    schemaVersion: 11,
    fixture: '__fixtures__/input-queue-v11.json',
    expectedQuarantinedKeys: ['00000000-0000-4000-8000-000000000020'],
    schemas: inputQueueV11Schemas,
    fingerprint: 'fa36d3c9126218e7827b974c5a849fde811edbc4e970520e98152b2c898c0f4c',
  },
  {
    schemaVersion: 12,
    fixture: null,
    expectedQuarantinedKeys: [],
    schemas: inputQueueV12Schemas,
    fingerprint: '6206c12811b9d6c199769b3c6a402c8752abecebb868bb74d95383e44ff68f65',
  },
];
