import { createContext } from "react";

/**
 * Lets a review that owns the decision controls, such as a proposal group,
 * withhold approval from a pending member whose current content cannot be
 * shown. Returns the release for when the content loads.
 */
export const ProposalContentBlockedContext = createContext<
  ((proposalId: string) => () => void) | null
>(null);
