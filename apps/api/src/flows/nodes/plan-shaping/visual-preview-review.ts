import type { PlanFromDesignDocFlowContext } from 'src/types/flow-internal.types';

export type VisualPreviewEntry = NonNullable<
  PlanFromDesignDocFlowContext['visualPreviewEntries']
>[number];

export type ApprovedVisualSnapshot = NonNullable<
  PlanFromDesignDocFlowContext['visualPreviewApprovedBeforeTurn']
>[number];

export type ApprovedVisualChange = NonNullable<
  PlanFromDesignDocFlowContext['visualPreviewApprovedChanges']
>[number];

/** Where the visual review stands, decided from live proposal status. */
export type VisualReviewPosition =
  | {
      kind: 'visual';
      /** The visuals the user decides now, in presentation order. */
      review: VisualPreviewEntry[];
      /** Earlier visuals plus the ones under review, in presentation order. */
      presented: VisualPreviewEntry[];
    }
  | { kind: 'set'; presented: VisualPreviewEntry[] };

export const orderVisualEntries = (
  entries: readonly VisualPreviewEntry[],
): VisualPreviewEntry[] =>
  [...entries].sort(
    (left, right) => left.presentationOrder - right.presentationOrder,
  );

/** Every visual in presentation order whose live status is not APPROVED. */
export const findUnapprovedEntries = (
  entries: readonly VisualPreviewEntry[],
  statusById: ReadonlyMap<string, string>,
): VisualPreviewEntry[] =>
  orderVisualEntries(entries).filter(
    (entry) => statusById.get(entry.proposalId) !== 'APPROVED',
  );

/**
 * Every visual that is not APPROVED is under review together: the agent adds
 * one at a time unless several belong together. When every visual is approved
 * but the agent has not declared the set complete, the newest visual stays
 * presented so the user can move on to the next one. Only an all-approved,
 * complete set is presented as the complete set.
 */
export const resolveVisualReviewPosition = (
  entries: readonly VisualPreviewEntry[],
  statusById: ReadonlyMap<string, string>,
  setComplete: boolean,
): VisualReviewPosition => {
  const ordered = orderVisualEntries(entries);
  const unapproved = findUnapprovedEntries(ordered, statusById);
  const newest = ordered[ordered.length - 1];
  const review =
    unapproved.length > 0 ? unapproved : !setComplete && newest ? [newest] : [];

  const lastUnderReview = review[review.length - 1];
  if (!lastUnderReview) {
    return { kind: 'set', presented: ordered };
  }

  return {
    kind: 'visual',
    review,
    presented: ordered.filter(
      (entry) => entry.presentationOrder <= lastUnderReview.presentationOrder,
    ),
  };
};

/**
 * The structural checks on an agent's visual set. The agent may redraw, drop,
 * replace, reorder or add any visual; the API only makes sure nothing is lost
 * by accident. A visual this conversation proposed that is left out of the set
 * must have had its proposal deleted, so no stray draft is left for the user
 * to approve later. An approved visual is already a Mockup or Diagram in the
 * project, and leaving it out is reported to the user at the next review
 * instead. A reused proposal from another conversation is never the agent's
 * to delete, so leaving it out is enough. Returns the correction to send back to the
 * agent, or undefined when the set is valid.
 */
export const findSubmissionViolation = ({
  previousEntries,
  submittedEntries,
  ownStatusById,
  setComplete,
}: {
  previousEntries: readonly VisualPreviewEntry[];
  submittedEntries: readonly VisualPreviewEntry[];
  /**
   * Live status of each previous visual this conversation proposed; absent
   * when its proposal is gone or came from another conversation.
   */
  ownStatusById: ReadonlyMap<string, string>;
  setComplete: boolean;
}): string | undefined => {
  const submittedIds = new Set(
    submittedEntries.map((entry) => entry.proposalId),
  );
  const leftInPlace = orderVisualEntries(previousEntries)
    .map((entry) => entry.proposalId)
    .filter((proposalId) => !submittedIds.has(proposalId))
    .filter((proposalId) => {
      const status = ownStatusById.get(proposalId);
      return status !== undefined && status !== 'APPROVED';
    });
  if (leftInPlace.length > 0) {
    return `These visuals were left out of the set but their proposals still exist: ${leftInPlace.join(', ')}. Delete each dropped visual's proposal with delete_proposal, or keep it in the set.`;
  }

  if (submittedEntries.length === 0 && !setComplete) {
    return 'The set is empty. Draft the visuals the work needs, or submit with setComplete true when it needs none.';
  }
  return undefined;
};

/**
 * Names each visual that was approved before this turn and is no longer in
 * the set. One is "changed" when a new proposal in the set updates the same
 * Mockup or Diagram, and "removed" otherwise.
 */
export const findApprovedVisualChanges = (
  approvedBeforeTurn: readonly ApprovedVisualSnapshot[],
  submittedProposals: ReadonlyArray<{
    id: string;
    action: string;
    targetEntityId: string;
  }>,
): ApprovedVisualChange[] => {
  const submittedIds = new Set(submittedProposals.map(({ id }) => id));
  const updatedTargets = new Set(
    submittedProposals
      .filter(({ action }) => action === 'UPDATE')
      .map(({ targetEntityId }) => targetEntityId),
  );
  return approvedBeforeTurn
    .filter(({ proposalId }) => !submittedIds.has(proposalId))
    .map(({ proposalId, title, targetEntityId }) => ({
      proposalId,
      title,
      change: updatedTargets.has(targetEntityId) ? 'changed' : 'removed',
    }));
};

const quoteTitles = (changes: readonly ApprovedVisualChange[]): string =>
  changes.map(({ title }) => `"${title}"`).join(', ');

/** The review-screen notice naming approved visuals the agent changed or removed. */
export const describeApprovedVisualChanges = (
  changes: readonly ApprovedVisualChange[],
): string | undefined => {
  const changed = changes.filter(({ change }) => change === 'changed');
  const removed = changes.filter(({ change }) => change === 'removed');
  const lines = [
    ...(changed.length > 0
      ? [`Changed after you approved it: ${quoteTitles(changed)}.`]
      : []),
    ...(removed.length > 0
      ? [`Removed from the set after you approved it: ${quoteTitles(removed)}.`]
      : []),
  ];
  return lines.length > 0 ? lines.join('\n') : undefined;
};
