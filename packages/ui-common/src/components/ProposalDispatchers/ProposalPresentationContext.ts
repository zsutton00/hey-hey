import { createContext } from "react";

/**
 * Presentation-local policy; canonical proposal eligibility remains shared.
 * "evaluation-output" replaces every approval control with the evaluation
 * badge; the server independently refuses to apply such proposals.
 */
export type ProposalPresentation =
  "actionable" | "read-only" | "evaluation-output";

export const ProposalPresentationContext =
  createContext<ProposalPresentation>("actionable");
