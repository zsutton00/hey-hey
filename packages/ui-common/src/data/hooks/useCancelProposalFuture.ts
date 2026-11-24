import {
  FutureRevisionCancellationOperationEnum,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  type FutureRevisionCancellation,
  type FutureRevisionResponse,
  type ProposalResponseDto,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import {
  useMutation,
  type MutationOptions,
  type MutationResult,
} from "../core/useMutation";
import { useInvalidateProposalReview } from "./useInvalidateProposalReview";
import { logger } from "../../utils/logger";

export interface CancelProposalFutureRequest {
  future: FutureRevisionResponse;
  /** Pending refinements the user saw in the confirmation. */
  reviewedRefinementProposalIds: string[];
  /** A stale pending cancellation of this future, withdrawn before the new one is created. */
  replaceProposalId?: string;
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    (error as { response?: { status?: number } }).response?.status === 409
  );
}

export type UseCancelProposalFutureReturn = MutationResult<
  CancelProposalFutureRequest,
  ProposalResponseDto
>;

/**
 * Cancels an approved, unapplied future through the ordinary `CANCEL`
 * proposal. The user's confirmation is their approval, so it is recorded
 * straight away; the server still decides whether that satisfies the project's
 * approval rules. The returned proposal is APPROVED when it does, otherwise it
 * remains DRAFT awaiting further approvals.
 */
export function useCancelProposalFuture(
  options: MutationOptions<ProposalResponseDto> = {},
): UseCancelProposalFutureReturn {
  const invalidateReview = useInvalidateProposalReview();
  return useMutation(
    async ({
      future,
      reviewedRefinementProposalIds,
      replaceProposalId,
    }: CancelProposalFutureRequest) => {
      try {
        if (replaceProposalId) {
          await proposalsClient.rejectProposal({
            organizationId: future.organizationId,
            projectId: future.projectId,
            proposalId: replaceProposalId,
            rejectProposalDto: {
              reason:
                "Replaced by a new cancellation after the pending revisions changed.",
            },
          });
        }
        const response = await proposalsClient.createProposal({
          organizationId: future.organizationId,
          projectId: future.projectId,
          createProposalRequestDto: {
            type: ProposalType.Single,
            action: ProposalAction.VersionedUpdate,
            targetEntityId: future.targetEntityId,
            targetEntityType: future.targetEntityType,
            eli5: "Cancel this approved change before it is applied.",
            updates: {
              operation: FutureRevisionCancellationOperationEnum.Cancel,
              futureId: future.id,
              expectedRevision: future.revision,
              reviewedRefinementProposalIds,
            } satisfies FutureRevisionCancellation,
          },
        });
        if (!response.data.data) {
          throw new Error("Cancellation was submitted without a proposal");
        }
        const created = response.data.data;
        if (created.status !== ProposalStatus.Draft) {
          return created;
        }

        try {
          const approved = await proposalsClient.updateProposal({
            organizationId: future.organizationId,
            projectId: future.projectId,
            proposalId: created.id,
            updateProposalDto: { status: ProposalStatus.Approved },
          });
          return approved.data.data ?? created;
        } catch (error) {
          if (isConflict(error)) {
            // The reviewed revisions changed: the reviewer must see the server's
            // reason and replace the request, not wait on an approval that cannot succeed.
            throw error;
          }
          // Otherwise the cancellation stays a pending proposal other approvers can decide.
          logger.error("api", "Could not approve the future cancellation", {
            proposalId: created.id,
            error,
          });
          return created;
        }
      } finally {
        invalidateReview(future.organizationId, future.projectId);
      }
    },
    options,
  );
}
