import type { PlanFromDesignDocFlowContext } from 'src/types/flow-internal.types';

export type VisualPreviewEntry = NonNullable<
  PlanFromDesignDocFlowContext['visualPreviewEntries']
>[number];

/** Where the visual review stands, decided from live proposal status. */
export type VisualReviewPosition =
  | {
      kind: 'visual';
      /** The one visual the user decides now. */
      review: VisualPreviewEntry;
      /** Earlier visuals plus the one under review, in presentation order. */
      presented: VisualPreviewEntry[];
    }
  | { kind: 'set'; presented: VisualPreviewEntry[] };

export const orderVisualEntries = (
  entries: readonly VisualPreviewEntry[],
): VisualPreviewEntry[] =>
  [...entries].sort(
    (left, right) => left.presentationOrder - right.presentationOrder,
  );

/** The first visual in presentation order whose live status is not APPROVED. */
export const findFirstUnapprovedEntry = (
  entries: readonly VisualPreviewEntry[],
  statusById: ReadonlyMap<string, string>,
): VisualPreviewEntry | undefined =>
  orderVisualEntries(entries).find(
    (entry) => statusById.get(entry.proposalId) !== 'APPROVED',
  );

/**
 * Visuals are reviewed one by one in presentation order. The first visual
 * that is not APPROVED is under review. When every visual is approved but the
 * agent has not declared the set complete, the newest visual stays presented
 * so the user can move on to the next one. Only an all-approved, complete set
 * is presented as the complete set.
 */
export const resolveVisualReviewPosition = (
  entries: readonly VisualPreviewEntry[],
  statusById: ReadonlyMap<string, string>,
  setComplete: boolean,
): VisualReviewPosition => {
  const ordered = orderVisualEntries(entries);
  const review =
    findFirstUnapprovedEntry(ordered, statusById) ??
    (setComplete ? undefined : ordered[ordered.length - 1]);

  if (!review) {
    return { kind: 'set', presented: ordered };
  }

  return {
    kind: 'visual',
    review,
    presented: ordered.filter(
      (entry) => entry.presentationOrder <= review.presentationOrder,
    ),
  };
};

export type VisualTurnScope = NonNullable<
  PlanFromDesignDocFlowContext['visualPreviewTurnScope']
>;

const sameSequence = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const listIds = (proposalIds: readonly string[]): string =>
  proposalIds.join(', ');

/**
 * Checks that an agent turn changed only what the user asked for. Visuals
 * the user did not ask to change keep their identity and presentation order;
 * the API never relies on the agent to carry them forward. Returns the
 * correction to send back to the agent, or undefined when the turn is valid.
 *
 * - redraft: only the visual under review may be replaced, in its place.
 * - next: every earlier visual stays, in order; new visuals are appended,
 *   and at most one of them may still need the user's decision.
 * - set_feedback: the user asked to change the complete set, so visuals may
 *   be replaced or removed; at most one undecided visual is added per
 *   replaced visual (at least one).
 * - no recorded scope: runs started before scopes were recorded keep the
 *   set_feedback rule once a set exists, and the next rule otherwise.
 */
export const findTurnScopeViolation = (
  previousEntries: readonly VisualPreviewEntry[],
  submittedEntries: readonly VisualPreviewEntry[],
  submittedStatusById: ReadonlyMap<string, string>,
  scope: VisualTurnScope | undefined,
): string | undefined => {
  const previousIds = orderVisualEntries(previousEntries).map(
    (entry) => entry.proposalId,
  );
  const submittedIds = orderVisualEntries(submittedEntries).map(
    (entry) => entry.proposalId,
  );
  const previousIdSet = new Set(previousIds);
  const submittedIdSet = new Set(submittedIds);
  const keptIds = submittedIds.filter((id) => previousIdSet.has(id));
  const newIds = submittedIds.filter((id) => !previousIdSet.has(id));
  const missingIds = previousIds.filter((id) => !submittedIdSet.has(id));
  const newUndecidedIds = newIds.filter(
    (id) => submittedStatusById.get(id) !== 'APPROVED',
  );

  const effectiveScope: VisualTurnScope =
    scope ??
    (previousIds.length === 0 ? { kind: 'next' } : { kind: 'set_feedback' });

  if (effectiveScope.kind === 'redraft') {
    const reviewIndex = previousIds.indexOf(effectiveScope.proposalId);
    if (reviewIndex === -1) {
      return `The visual under review (${effectiveScope.proposalId}) is no longer in the set. Submit the set unchanged except for its redraft.`;
    }
    const redraftedInPlace = sameSequence(submittedIds, previousIds);
    const replacedInPlace =
      newIds.length === 1 &&
      sameSequence(
        submittedIds,
        previousIds.map((id, index) =>
          index === reviewIndex ? newIds[0]! : id,
        ),
      );
    if (redraftedInPlace || replacedInPlace) {
      return undefined;
    }

    const otherMissingIds = missingIds.filter(
      (id) => id !== effectiveScope.proposalId,
    );
    const missingNote =
      otherMissingIds.length > 0
        ? ` Missing: ${listIds(otherMissingIds)}.`
        : '';
    const addedNote = newIds.length > 1 ? ` Added: ${listIds(newIds)}.` : '';
    return `This turn redrafts only the visual under review (${effectiveScope.proposalId}). Keep every other visual unchanged and in the same order, and put its redraft in its place.${missingNote}${addedNote}`;
  }

  if (effectiveScope.kind === 'next') {
    if (!sameSequence(keptIds, previousIds) || missingIds.length > 0) {
      return `Keep every earlier visual unchanged and in the same order, then add the next visual after them.${missingIds.length > 0 ? ` Missing: ${listIds(missingIds)}.` : ''}`;
    }
    if (!sameSequence(submittedIds, [...previousIds, ...newIds])) {
      return 'Add the next visual after every earlier visual; do not insert it between them.';
    }
    if (newUndecidedIds.length > 1) {
      return `Draft one visual per turn: this submission adds ${newUndecidedIds.length} visuals that are not approved yet (${listIds(newUndecidedIds)}). Keep only the next visual in order and submit again.`;
    }
    return undefined;
  }

  const allowedNewUndecided = Math.max(1, missingIds.length);
  if (newUndecidedIds.length > allowedNewUndecided) {
    return `Draft one visual per turn: this submission adds ${newUndecidedIds.length} visuals that are not approved yet (${listIds(newUndecidedIds)}). Add at most one replacement for each visual the user asked to change and submit again.`;
  }
  return undefined;
};
