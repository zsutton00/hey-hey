import type { ProposalTargetFailure } from "../../data/hooks/proposalTargetRead";
import type { EntityData } from "./useEntityData";

/** One proposal target as its card sees it. */
export type ProposalTarget =
  | EntityData
  | { type: "loading" }
  | { type: "unavailable"; failure: ProposalTargetFailure };

/** The target's content, when there is content to show. */
export const loadedEntity = (
  target: ProposalTarget | undefined,
): EntityData | undefined =>
  target?.type === "task" || target?.type === "designDoc" ? target : undefined;
