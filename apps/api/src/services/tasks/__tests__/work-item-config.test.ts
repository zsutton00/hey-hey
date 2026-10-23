import { BadRequestException, ConflictException } from '@nestjs/common';
import { WorkItemConfigKind } from '../../../generated/model/workItemConfigKind';
import {
  readWorkItemConfig,
  validateWorkItemConfig,
  validateWorkItemConfigForType,
} from '../work-item-config';

const INITIAL_WORKTREE_CONFIG = {
  kind: WorkItemConfigKind.InitialWorktree,
  version: 'v1' as const,
  initialWorktreeBranch: 'feature/launch-default',
};

describe('work-item config validation', () => {
  it('preserves null and a nullable initial branch through validation', () => {
    expect(validateWorkItemConfig(null)).toBeNull();
    expect(validateWorkItemConfig(undefined)).toBeNull();
    expect(
      validateWorkItemConfig({
        ...INITIAL_WORKTREE_CONFIG,
        initialWorktreeBranch: null,
      }),
    ).toEqual({
      ...INITIAL_WORKTREE_CONFIG,
      initialWorktreeBranch: null,
    });
  });

  it('rejects unknown versions on write but omits them from compatible reads', () => {
    const unknownVersion = {
      ...INITIAL_WORKTREE_CONFIG,
      version: 'v2',
    };

    expect(() => validateWorkItemConfig(unknownVersion)).toThrow(
      BadRequestException,
    );
    expect(readWorkItemConfig(unknownVersion)).toBeNull();
  });

  it('omits unknown config kinds from compatible reads', () => {
    expect(
      readWorkItemConfig({
        ...INITIAL_WORKTREE_CONFIG,
        kind: 'FUTURE_KIND',
      }),
    ).toBeNull();
  });

  it('surfaces malformed values for a known config version', () => {
    expect(() =>
      readWorkItemConfig({
        ...INITIAL_WORKTREE_CONFIG,
        initialWorktreeBranch: 42,
      }),
    ).toThrow(ConflictException);
  });

  it('requires explicit config-kind acceptance from the effective type policy', () => {
    expect(() =>
      validateWorkItemConfigForType(INITIAL_WORKTREE_CONFIG, [], 'STANDARD'),
    ).toThrow("does not accept config kind 'INITIAL_WORKTREE'");

    expect(
      validateWorkItemConfigForType(
        INITIAL_WORKTREE_CONFIG,
        [WorkItemConfigKind.InitialWorktree],
        'CUSTOM_TYPE',
      ),
    ).toEqual(INITIAL_WORKTREE_CONFIG);
  });
});
