import { describe, expect, it } from 'vitest';
import { parseMigrateRunStoreArguments } from './migrate-run-store-args';

describe('parseMigrateRunStoreArguments', () => {
  it('defaults to a quiet dry run', () => {
    expect(parseMigrateRunStoreArguments([])).toEqual({ apply: false, verbose: false });
  });

  it('accepts apply and verbose flags with the pnpm separator', () => {
    expect(parseMigrateRunStoreArguments(['--', '--apply', '--verbose'])).toEqual({
      apply: true,
      verbose: true,
    });
  });

  it('rejects unsupported arguments', () => {
    expect(() => parseMigrateRunStoreArguments(['--all'])).toThrow('Unsupported argument: --all');
  });
});
