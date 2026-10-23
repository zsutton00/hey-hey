import { describe, expect, it } from 'vitest';
import { parseCullRunStoreArguments } from './cull-run-store-args';

describe('parseCullRunStoreArguments', () => {
  it('defaults to a safe garbage-only dry run', () => {
    expect(parseCullRunStoreArguments([])).toEqual({
      apply: false,
      verbose: false,
      keepRecentCompleted: 0,
    });
  });

  it('parses explicit completed-Run retention', () => {
    expect(
      parseCullRunStoreArguments([
        '--',
        '--apply',
        '--verbose',
        '--completed-before=2026-07-01',
        '--keep-recent-completed=100',
      ]),
    ).toEqual({
      apply: true,
      verbose: true,
      completedBefore: new Date('2026-07-01T00:00:00.000Z'),
      keepRecentCompleted: 100,
    });
  });

  it('rejects invalid or incomplete retention arguments', () => {
    expect(() => parseCullRunStoreArguments(['--completed-before=2026-02-30'])).toThrow(
      'valid calendar date',
    );
    expect(() => parseCullRunStoreArguments(['--keep-recent-completed=10'])).toThrow(
      'requires --completed-before',
    );
    expect(() => parseCullRunStoreArguments(['--all'])).toThrow('Unsupported argument');
  });
});
