import { AgentSessionServicePlaceKind } from '@hey-hey/contracts/api/models';
import type { AgenticSession } from '../session/types';

/** The Run state that says where each Service works. */
export type ActivePlaceSources = {
  [Key in 'worktreeState' | 'mainFolderBranches']?: AgenticSession[Key] | null | undefined;
};

export type ActiveServicePlace =
  | { kind: typeof AgentSessionServicePlaceKind.Worktree; branch: string; worktreePath: string }
  /** `branch` is null when detached and undefined when it could not be read. */
  | { kind: typeof AgentSessionServicePlaceKind.MainFolder; branch: string | null | undefined };

/** A Service with a worktree on the Run works there; any other works in its main folder. */
export const activeServicePlace = (
  sources: ActivePlaceSources,
  serviceId: string,
): ActiveServicePlace => {
  const worktree = sources.worktreeState?.[serviceId];

  if (worktree) {
    return {
      kind: AgentSessionServicePlaceKind.Worktree,
      branch: worktree.branch,
      worktreePath: worktree.worktreePath,
    };
  }

  return {
    kind: AgentSessionServicePlaceKind.MainFolder,
    branch: sources.mainFolderBranches?.[serviceId],
  };
};
