import {
  AgentSessionServicePlaceKind,
  type AgentSessionServiceLocation,
} from "../../api";

/** Names where a Service works, e.g. "dev (main folder)". */
export const describeServiceLocation = ({
  kind,
  branch,
}: AgentSessionServiceLocation): string => {
  if (kind === AgentSessionServicePlaceKind.Worktree) {
    return `${branch} (worktree)`;
  }

  return branch === null ? "main folder (detached)" : `${branch} (main folder)`;
};
