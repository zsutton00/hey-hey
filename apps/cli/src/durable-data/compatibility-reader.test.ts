import { describe, expect, it, vi } from 'vitest';
import {
  DurableDataCompatibilityReader,
  type DurableDataSource,
  type JsonValue,
  type VersionedDataFamily,
} from './index';

const source: DurableDataSource = {
  paths: ['/durable/source.json'],
  bytesByPath: new Map([['/durable/source.json', new TextEncoder().encode('original')]]),
};

const family = (
  sourceSchemaVersion: number,
  overrides: Partial<VersionedDataFamily<{ value: number }>> = {},
): VersionedDataFamily<{ value: number }> => ({
  familyId: 'test-family',
  currentSchemaVersion: 3,
  readSource: async () => source,
  decodeSource: (candidate) => ({
    source: candidate,
    sourceSchemaVersion,
    writerApplicationVersion: '1.0.0',
    payload: { value: sourceSchemaVersion },
  }),
  migrations: new Map<number, (payload: JsonValue) => JsonValue>([
    [1, () => ({ value: 2 })],
    [2, () => ({ value: 3 })],
  ]),
  validateCurrent: (payload) => payload as { value: number },
  promoteAtomically: vi.fn(async () => undefined),
  ...overrides,
});

describe('DurableDataCompatibilityReader', () => {
  it('opens current data without promotion', async () => {
    const candidate = family(3);
    const result = await new DurableDataCompatibilityReader('3.2.1', vi.fn()).open(candidate);
    expect(result).toMatchObject({ status: 'ready', migrated: false, value: { value: 3 } });
    expect(candidate.promoteAtomically).not.toHaveBeenCalled();
  });

  it('applies every sequential migration before one promotion', async () => {
    const candidate = family(1);
    const result = await new DurableDataCompatibilityReader('3.2.1', vi.fn()).open(candidate);
    expect(result).toMatchObject({ status: 'ready', migrated: true, value: { value: 3 } });
    expect(candidate.promoteAtomically).toHaveBeenCalledOnce();
  });

  it.each([
    ['unsupported_newer_schema', family(4)],
    ['missing_migration', family(1, { migrations: new Map() })],
    [
      'migration_failed',
      family(1, {
        migrations: new Map([
          [
            1,
            () => {
              throw new Error('no');
            },
          ],
        ]),
      }),
    ],
    [
      'production_codec_rejected',
      family(3, {
        validateCurrent: () => {
          throw new Error('no');
        },
      }),
    ],
    [
      'promotion_failed',
      family(1, {
        promoteAtomically: async () => {
          throw new Error('no');
        },
      }),
    ],
  ] as const)('preserves source data for %s', async (reason, candidate) => {
    const before = new Uint8Array(source.bytesByPath.get(source.paths[0]!)!);
    const result = await new DurableDataCompatibilityReader('3.2.1', vi.fn()).open(candidate);
    expect(result).toMatchObject({ status: 'incompatible', diagnostic: { reason } });
    expect(source.bytesByPath.get(source.paths[0]!)).toEqual(before);
  });
});
