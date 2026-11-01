import { JourneyCanvas } from "./JourneyCanvas";
import { JourneyScreen } from "./JourneyScreen";
import React from "react";
import { Alert, Box, CircularProgress, Typography, Stack } from "@mui/material";
import { SavedJourneyScreen } from "./SavedJourneyScreen";

import { useAuth } from "../../contexts/AuthContext";
import type {
  ProposalGroupMemberSnapshot,
  ProposalGroupSnapshot,
  ProposalResponseDto,
} from "../../api";
import { projectCanonicalProposalGroupGraph } from "./canonicalProposalGroupGraph";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import {
  isCreateTaskUpdates,
  isWorkItemGraphProposal,
} from "../ProposalDispatchers/types";
import {
  projectWorkItemGraphForWorkflowSurface,
  getDiagramElementMetadata,
} from "../shared/WorkflowMentionInlineRenderer";
import {
  getMemberDecision,
  MemberDecisionControls,
  MemberState,
} from "./ProposalGroupMemberReview";

interface Props {
  group: ProposalGroupSnapshot;
  journey: ProposalGroupMemberSnapshot;
  onApprove: (proposalId: string) => Promise<unknown>;
  onReject: (proposalId: string, reason: string) => Promise<unknown>;
  decidingProposalIds: ReadonlySet<string>;
  decisionProposals: ReadonlyMap<string, ProposalResponseDto>;
}

const ScreenControls: React.FC<
  Omit<Props, "journey"> & { member: ProposalGroupMemberSnapshot }
> = ({
  group,
  member,
  onApprove,
  onReject,
  decidingProposalIds,
  decisionProposals,
}) => {
  const { user } = useAuth();
  const proposal = decisionProposals.get(member.proposal.id) ?? member.proposal;
  return (
    <Stack
      data-testid="journey-proposed-screen-review"
      data-proposal-id={member.proposal.id}
      spacing={0.75}
    >
      <MemberState member={member} members={group.members} />
      <MemberDecisionControls
        member={member}
        decision={getMemberDecision(proposal, user?.id)}
        proposalStatus={proposal.status}
        onApprove={onApprove}
        onReject={onReject}
        isDeciding={decidingProposalIds.has(proposal.id)}
      />
    </Stack>
  );
};

/** The authored Diagram determines transitions; group dependencies only govern application. */
export const ProposalGroupJourneyReview: React.FC<Props> = (props) => {
  const { group } = props;
  const registry = useWorkItemTypes(group.organizationId, {
    projectId: group.projectId,
  });
  const definition = registry.workItemTypes.find(
    ({ definition }) => definition.key === "DIAGRAM",
  )?.definition;
  const graph = definition
    ? projectCanonicalProposalGroupGraph(group, definition)
    : null;
  if (registry.isLoading) {
    return <CircularProgress aria-label="Loading journey" />;
  }
  if (graph?.kind !== "ready") {
    return (
      <Alert severity="warning">The journey preview is unavailable. </Alert>
    );
  }
  const surface = projectWorkItemGraphForWorkflowSurface(graph.projection, {
    organizationId: group.organizationId,
    projectId: group.projectId,
  });
  const savedPositions = new Map(
    graph.projection.layoutSource === "authored"
      ? graph.projection.effectiveLayout.nodes.map(({ node, position }) => [
          node.refType === "existing" ? node.id : `temporary:${node.tempId}`,
          position,
        ])
      : [],
  );
  const screens = group.members.filter(
    ({ proposal, reservedEntityId }) =>
      reservedEntityId &&
      !isWorkItemGraphProposal(proposal) &&
      isCreateTaskUpdates(proposal) &&
      proposal.updates.type === "mockup",
  );
  return (
    <Box data-testid="proposal-group-journey-review">
      <JourneyCanvas
        steps={surface.steps}
        edges={surface.edges}
        savedPositions={savedPositions}
        renderScreen={(step) => {
          const reference = getDiagramElementMetadata(step)?.canonicalReference;
          const member = screens.find(
            ({ reservedEntityId }) => reservedEntityId === reference?.entityId,
          );
          if (member && isCreateTaskUpdates(member.proposal)) {
            return (
              <JourneyScreen
                name={member.proposal.updates.name}
                source={{ kind: "proposal", proposalId: member.proposal.id }}
                sections={(member.proposal.updates.sections ?? []).map(
                  (section) => ({
                    key: section.key,
                    materializedMarkdown: section.content,
                  }),
                )}
                group={group}
              >
                <ScreenControls {...props} member={member} />
              </JourneyScreen>
            );
          }
          if (reference?.entityType === "TASK") {
            return (
              <SavedJourneyScreen
                id={reference.entityId}
                name={step.name}
                group={group}
              />
            );
          }
          return (
            <Typography
              sx={{ p: 2, border: "1px solid", borderColor: "divider" }}
            >
              {step.name}
            </Typography>
          );
        }}
      />
    </Box>
  );
};
