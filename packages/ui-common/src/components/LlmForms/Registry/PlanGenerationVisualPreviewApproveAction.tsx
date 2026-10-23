import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from "@mui/material";
import React from "react";
import { ProposalStatus, type ProposalResponseDto } from "../../../api";
import { proposalsClient } from "../../../clients/serviceClients";
import { useConversationEvents } from "../../Conversation/hooks/useConversationEvents";
import { getEntry } from "../../ProposalDispatchers/proposalSelectedStateCache";
import { type SecondaryActionRenderContext } from "./types";

export type PlanGenerationVisualPreviewApproveActionProps = Pick<
  SecondaryActionRenderContext,
  "action" | "context" | "formValues" | "isSubmissionLocked" | "onExecute"
>;

type ApprovePhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "confirming"; draftCount: number }
  | { kind: "submitted" }
  | { kind: "error"; message: string };

/** Session decisions win over a server status that still reads DRAFT. */
const countUndecidedVisualProposals = (
  proposals: readonly Pick<ProposalResponseDto, "id" | "status">[]
): number =>
  proposals.filter(
    (proposal) =>
      proposal.status === ProposalStatus.Draft && !getEntry(proposal.id)
  ).length;

const loadCurrentVisualProposals = async (
  proposalIds: readonly string[],
  organizationId: string,
  projectId: string
): Promise<ProposalResponseDto[]> =>
  Promise.all(
    proposalIds.map(async (proposalId) => {
      const response = await proposalsClient.getProposal({
        organizationId,
        projectId,
        proposalId,
      });
      const proposal = response.data?.data;
      if (!proposal) {
        throw new Error("A visual proposal could not be loaded.");
      }
      return proposal;
    })
  );

/**
 * Approve Visual Set warns before the API auto-approves remaining DRAFT
 * visuals. It only submits the existing typed answer; the API owns approval.
 */
export const PlanGenerationVisualPreviewApproveAction: React.FC<
  PlanGenerationVisualPreviewApproveActionProps
> = ({ action, context, formValues, isSubmissionLocked, onExecute }) => {
  const [phase, setPhase] = React.useState<ApprovePhase>({ kind: "idle" });
  const submittedRef = React.useRef(false);
  const { on } = useConversationEvents(context.conversationId);

  // A failed submission leaves the set unanswered, so allow another attempt.
  React.useEffect(
    () =>
      on("submission-error", () => {
        submittedRef.current = false;
        setPhase((current) =>
          current.kind === "submitted" ? { kind: "idle" } : current
        );
      }),
    [on]
  );

  const submit = () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setPhase({ kind: "submitted" });
    onExecute(formValues);
  };

  const handleApprove = async () => {
    if (
      action.disabled ||
      isSubmissionLocked ||
      phase.kind === "checking" ||
      submittedRef.current
    ) {
      return;
    }
    const proposalIds = context.currentVisualPreviewProposalIds;
    if (!proposalIds) {
      setPhase({
        kind: "error",
        message: "The current visual set could not be found.",
      });
      return;
    }
    setPhase({ kind: "checking" });
    try {
      const proposals = await loadCurrentVisualProposals(
        proposalIds,
        context.organizationId,
        context.projectId
      );
      const draftCount = countUndecidedVisualProposals(proposals);
      if (draftCount === 0) {
        submit();
        return;
      }
      setPhase({ kind: "confirming", draftCount });
    } catch (loadError: unknown) {
      setPhase({
        kind: "error",
        message:
          loadError instanceof Error
            ? loadError.message
            : "The current visual set could not be checked.",
      });
    }
  };

  const busy = phase.kind === "checking" || phase.kind === "submitted";

  return (
    <Stack spacing={1} alignItems="flex-start">
      <Button
        variant="contained"
        size="small"
        disabled={action.disabled || isSubmissionLocked || busy}
        sx={{ py: 1.5, px: 2 }}
        onClick={() => void handleApprove()}
        data-testid="plan-generation-visual-preview-approve"
      >
        {action.label}
      </Button>
      {phase.kind === "error" && (
        <Alert
          severity="error"
          data-testid="plan-generation-visual-preview-approve-error"
        >
          {phase.message}
        </Alert>
      )}
      <Dialog
        open={phase.kind === "confirming"}
        onClose={() => setPhase({ kind: "idle" })}
        data-testid="plan-generation-visual-preview-approve-confirm"
      >
        <DialogTitle>Approve the remaining visuals?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {phase.kind === "confirming" &&
              (phase.draftCount === 1
                ? "1 visual in this set is still awaiting review."
                : `${phase.draftCount} visuals in this set are still awaiting review.`)}
          </DialogContentText>
          <DialogContentText>
            Continuing automatically approves the remaining visual proposals
            before stage selection.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setPhase({ kind: "idle" })}
            data-testid="plan-generation-visual-preview-approve-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submit}
            data-testid="plan-generation-visual-preview-approve-continue"
          >
            Approve and continue
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
