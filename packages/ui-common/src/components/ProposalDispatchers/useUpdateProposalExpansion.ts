import { useState } from "react";
import { ProposalAction, type ProposalResponseDto } from "../../api";
import { useProposal } from "../../data/hooks/useProposal";
import type { ProposalItemStatus } from "./types";

/**
 * Approval hides the comparison; only application switches it to final content.
 * Review surfaces that ask to `startExpanded` keep it open until the user collapses it.
 */
export function useUpdateProposalExpansion(
  proposal: ProposalResponseDto,
  status: ProposalItemStatus,
  presentationAction: ProposalAction | undefined,
  needsReconciliation: boolean,
  startExpanded: boolean,
) {
  const future = presentationAction === ProposalAction.VersionedUpdate;
  const { proposal: current } = useProposal(
    proposal.organizationId,
    proposal.projectId,
    proposal.id,
    { enabled: future },
  );
  const isApplied =
    status.state === "applied" ||
    (future && current?.reviewedFuture?.outcome === "APPLIED");
  const accepted =
    isApplied ||
    status.reviewAccepted ||
    (future && (current ?? proposal).status === "APPROVED");
  const collapsible = !!accepted && !needsReconciliation;
  const initiallyExpanded = startExpanded || !collapsible;
  const [selection, setSelection] = useState({
    collapsible,
    isApplied,
    expanded: initiallyExpanded,
  });
  // Reset on the approval/application transition, including without a remount.
  if (
    selection.collapsible !== collapsible ||
    selection.isApplied !== isApplied
  ) {
    setSelection({ collapsible, isApplied, expanded: initiallyExpanded });
  }
  const expanded =
    selection.collapsible === collapsible && selection.isApplied === isApplied
      ? selection.expanded
      : initiallyExpanded;
  return {
    isApplied,
    collapsible,
    expanded,
    toggleExpanded: () =>
      setSelection({ collapsible, isApplied, expanded: !expanded }),
  };
}
