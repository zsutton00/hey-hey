import React, { createContext, useContext } from "react";
import { Box, Stack, Typography } from "@mui/material";
import type {
  ProposalApprovalExplanation,
  ProposalResponseDto,
} from "../../api";
import { getApprovalProgress } from "../../permissions";
import {
  approvalRequirementLabel,
  approvalSourceLabel,
  matchedApprovalConditions,
} from "./approvalExplanationPresentation";
import type { ProposalRenderMode } from "./types";
import { ProposalPresentationContext } from "./ProposalPresentationContext";

export const ProposalApprovalEligibilityContext = createContext<
  boolean | undefined
>(undefined);

export function ProposalApprovalDetails({
  proposal,
}: {
  proposal: ProposalResponseDto;
}) {
  const explanation = proposal.approvalExplanation;
  if (!explanation) {
    return null;
  }
  if (explanation.evidence === "UNAVAILABLE") {
    return (
      <Box
        component="section"
        aria-label="Approval details"
        data-testid="proposal-approval-details"
        sx={{ p: 2 }}
      >
        <Typography variant="body2">
          Historical approval details are unavailable for this proposal. Current
          settings cannot reconstruct its decision.
        </Typography>
      </Box>
    );
  }
  return (
    <ApprovalEvidenceDetails proposal={proposal} explanation={explanation} />
  );
}

function ApprovalEvidenceDetails({
  proposal,
  explanation,
}: {
  proposal: ProposalResponseDto;
  explanation: ProposalApprovalExplanation;
}) {
  const progress = getApprovalProgress(
    proposal.requiredApprovals,
    proposal.approvals,
  );
  const requirement = explanation.requirement;
  const applied =
    proposal.status === "APPROVED" &&
    (!proposal.materialization ||
      proposal.materialization.state === "PUBLISHED");
  const combinedEdit =
    explanation.changedFields?.includes("status") &&
    explanation.changedFieldClassification?.contentChange;
  return (
    <Box
      component="section"
      aria-label="Approval details"
      data-testid="proposal-approval-details"
      sx={{ p: 2, borderTop: 1, borderColor: "divider" }}
    >
      <Stack spacing={1}>
        {requirement?.category === "IMMEDIATE" ? (
          <Typography variant="subtitle2">
            {explanation.evidence === "CAPTURED" && applied
              ? "Applied immediately"
              : "No human approval required"}
          </Typography>
        ) : (
          <Typography variant="subtitle2">
            {progress.approvalCount} of {proposal.requiredApprovals} human
            approvals
          </Typography>
        )}
        {proposal.requiredApprovals !== null &&
          proposal.requiredApprovals > 0 && (
            <Box
              component="progress"
              value={progress.approvalCount}
              max={proposal.requiredApprovals}
              aria-label={`${progress.approvalCount} of ${proposal.requiredApprovals} human approvals`}
              sx={{ width: "100%" }}
            />
          )}
        {requirement?.category === "IMMEDIATE" && (
          <Typography variant="body2">
            This proposal remains the audit record of the change.
          </Typography>
        )}
        <Box component="details" open>
          <Box
            component="summary"
            tabIndex={0}
            data-testid="proposal-approval-details-toggle"
            sx={{
              cursor: "pointer",
              typography: "body2",
              fontWeight: "bold",
              "&:focus-visible": {
                outline: "2px solid",
                outlineColor: "primary.main",
                outlineOffset: 3,
              },
            }}
          >
            Why this rule applied
          </Box>
          <Box
            component="dl"
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(90px, auto) 1fr",
              gap: 1,
              my: 1,
              "& dt": { color: "text.secondary" },
              "& dd": { m: 0 },
            }}
          >
            <dt>Matched rule</dt>
            <dd>
              {explanation.conditions
                ? matchedApprovalConditions(explanation.conditions)
                : "Unavailable"}
            </dd>
            <dt>Source</dt>
            <dd>{approvalSourceLabel(explanation.source)}</dd>
            <dt>Requirement</dt>
            <dd>
              {requirement
                ? approvalRequirementLabel(requirement)
                : "Unavailable"}
            </dd>
            <dt>Changed fields</dt>
            <dd>
              {explanation.changedFields?.length
                ? explanation.changedFields.join(", ")
                : "No content fields"}
            </dd>
            <dt>Proposer credit</dt>
            <dd>
              {explanation.creditedProposerApprovals === 1
                ? "1 approval credited to the eligible user proposer under this rule."
                : "No human proposer approval credited."}
            </dd>
          </Box>
          {combinedEdit && (
            <Typography variant="body2">
              Status and content changed together, so the status-only rule does
              not match.
            </Typography>
          )}
          {explanation.source === "FIXED" && (
            <Typography variant="body2">
              Project configuration cannot change this fixed rule.
            </Typography>
          )}
        </Box>
        {explanation.evidence === "LIVE" ? (
          <Typography variant="body2" color="text.secondary">
            {explanation.viewerEligibility.eligibleToApprove
              ? "You are eligible to approve this change."
              : "You cannot add an approval to this change."}{" "}
            Pending reviews use the effective settings on their next read or
            decision.
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Decision evidence retained in history. Later settings changes do not
            alter this explanation.
          </Typography>
        )}
      </Stack>
    </Box>
  );
}

/** One ordinary-item boundary shared by inline and detail dispatchers. */
export function OrdinaryProposalApprovalReview({
  proposal,
  renderMode,
  children,
}: {
  proposal: ProposalResponseDto;
  renderMode: ProposalRenderMode | undefined;
  children: React.ReactNode;
}) {
  const presentation = useContext(ProposalPresentationContext);
  if (
    proposal.groupMembership ||
    proposal.action === "VERSIONED_UPDATE" ||
    (renderMode !== undefined && renderMode !== "standalone") ||
    presentation === "evaluation-output" ||
    proposal.applicationEligible === false
  ) {
    return <>{children}</>;
  }
  const eligible =
    proposal.approvalExplanation?.evidence === "LIVE"
      ? proposal.approvalExplanation.viewerEligibility.eligibleToApprove
      : undefined;
  return (
    <ProposalApprovalEligibilityContext.Provider value={eligible}>
      {children}
      <ProposalApprovalDetails proposal={proposal} />
    </ProposalApprovalEligibilityContext.Provider>
  );
}

export function renderApprovalReviews(
  proposals: readonly ProposalResponseDto[],
  renderMode: ProposalRenderMode | undefined,
  renderProposal: (proposal: ProposalResponseDto) => React.ReactNode,
): React.ReactNode {
  return proposals.map((proposal) => (
    <OrdinaryProposalApprovalReview
      key={proposal.id}
      proposal={proposal}
      renderMode={renderMode}
    >
      {renderProposal(proposal)}
    </OrdinaryProposalApprovalReview>
  ));
}
