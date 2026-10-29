import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { getProposalElementEntityLinks } from "../ProposalDispatchers/WorkItemGraphProposalRenderer";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Chip,
  Typography,
  DialogContent,
  DialogTitle,
  Stack,
} from "@mui/material";
import { FunctionalDialog } from "../Modals/FunctionalDialog";
import { useModalState } from "../Modals/useModalState";
import { proposalsClient } from "../../clients/serviceClients";
import { useConversationMessages } from "../../data/hooks/useConversationMessages";
import { useWorkItem } from "../../data/hooks/useWorkItem";
import { usePathService } from "../../contexts/PathServiceContext";
import { useAuth } from "../../contexts/AuthContext";
import type {
  ProposalGroupMemberSnapshot,
  ProposalGroupSnapshot,
  ProposalResponseDto,
} from "../../api";
import { projectCanonicalProposalGroupGraph } from "./canonicalProposalGroupGraph";
import {
  ProposalScreenInspection,
  type ScreenReviewNote,
} from "./ProposalScreenInspection";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import {
  isCreateTaskUpdates,
  isWorkItemGraphProposal,
} from "../ProposalDispatchers/types";
import {
  WorkflowGraphSurface,
  projectWorkItemGraphForWorkflowSurface,
  getDiagramElementMetadata,
  type WorkItemGraphProjectionData,
} from "../shared/WorkflowMentionInlineRenderer";
import {
  getMemberDecision,
  MemberDecisionControls,
  MemberState,
  ProposalGroupMemberReview,
} from "./ProposalGroupMemberReview";

interface Props {
  group: ProposalGroupSnapshot;
  journey: ProposalGroupMemberSnapshot;
  onApprove: (proposalId: string) => Promise<unknown>;
  onReject: (proposalId: string, reason: string) => Promise<unknown>;
  decidingProposalIds: ReadonlySet<string>;
  decisionProposals: ReadonlyMap<string, ProposalResponseDto>;
}

const SavedScreen: React.FC<{ id: string; group: ProposalGroupSnapshot }> = ({
  id,
  group,
}) => {
  const read = useWorkItem(group.organizationId, "task", id, {
    projectId: group.projectId,
  });
  const paths = usePathService();
  if (read.isLoading) {
    return <Alert severity="info">Loading saved screen…</Alert>;
  }
  // A reference that resolves to something other than a Mockup (a Feature, a
  // Service, another Task type) is not this component's concern: the node's
  // own card already renders its generic content. Only a Mockup that is
  // missing or archived is this control's "unavailable" case.
  if (read.workItem && read.workItem.type !== "mockup") {
    return null;
  }
  if (!read.workItem || read.workItem.status === "ARCHIVED") {
    return <Alert severity="info">Screen unavailable</Alert>;
  }
  const description = read.workItem.sections?.find(
    ({ key }) => key === "purpose" || key === "description",
  )?.materializedMarkdown;
  return (
    <Stack
      data-testid="journey-saved-screen-review"
      data-work-item-id={id}
      spacing={1}
      sx={{ bgcolor: "background.paper", p: 1 }}
    >
      <Chip label="Accepted · saved screen" color="success" size="small" />
      {description ? (
        <Typography
          variant="caption"
          component="div"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          <MarkdownRenderer>{description}</MarkdownRenderer>
        </Typography>
      ) : null}
      <Button
        href={paths.task({ projectId: group.projectId, taskId: id })}
        aria-label={`Open saved screen ${read.workItem.name}`}
      >
        Open screen
      </Button>
    </Stack>
  );
};

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
  const [localNotes, setNotes] = useState<ScreenReviewNote[]>([]);
  const [savingNote, setSavingNote] = useState(false);
  const messages = useConversationMessages(
    group.organizationId,
    group.projectId,
    member.proposal.conversationId ?? undefined,
  );
  const savedNotes = messages.orderedData.flatMap((message) => {
    const record =
      message.type === "USER" ? message.data.proposalReviewNote : undefined;
    return record?.proposalId === member.proposal.id &&
      record.review.frozenRevision === group.frozenRevision
      ? [record]
      : [];
  });
  const notes = [
    ...new Map(
      [...savedNotes, ...localNotes].map((record) => [
        record.review.noteId,
        record,
      ]),
    ).values(),
  ];
  const [open, setOpen, ownerKey] = useModalState(false);
  const proposal = decisionProposals.get(member.proposal.id) ?? member.proposal;
  const description = isCreateTaskUpdates(member.proposal)
    ? member.proposal.updates.sections?.find(
        ({ key }) => key === "purpose" || key === "description",
      )?.content
    : undefined;
  return (
    <Stack
      data-testid="journey-proposed-screen-review"
      data-proposal-id={member.proposal.id}
      spacing={0.75}
      sx={{ bgcolor: "background.paper", p: 1, borderRadius: 1 }}
    >
      {typeof description === "string" ? (
        <Typography
          variant="caption"
          component="div"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          <MarkdownRenderer>{description}</MarkdownRenderer>
        </Typography>
      ) : null}
      <MemberState member={member} members={group.members} />
      <Button
        data-testid="journey-screen-inspect"
        size="small"
        onClick={() => setOpen(true)}
      >
        Inspect and annotate
      </Button>
      <MemberDecisionControls
        member={member}
        decision={getMemberDecision(proposal, user?.id)}
        proposalStatus={proposal.status}
        onApprove={onApprove}
        onReject={onReject}
        isDeciding={savingNote || decidingProposalIds.has(proposal.id)}
      />
      <FunctionalDialog
        open={open}
        ownerKey={ownerKey}
        onClose={() => {
          if (!savingNote) {
            setOpen(false);
          }
        }}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle>
          {member.proposal.title}
          <Button disabled={savingNote} onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogTitle>
        <DialogContent>
          {group.frozenRevision != null ? (
            <ProposalScreenInspection
              proposal={member.proposal}
              notes={notes}
              frozenRevision={group.frozenRevision}
              onAddNote={async (note) => {
                setSavingNote(true);
                try {
                  await proposalsClient.saveProposalReviewNote({
                    organizationId: group.organizationId,
                    projectId: group.projectId,
                    proposalId: member.proposal.id,
                    proposalReviewNoteDto: note.review,
                  });
                  setNotes((previous) => [...previous, note]);
                } finally {
                  setSavingNote(false);
                }
              }}
            />
          ) : (
            <Alert severity="warning">
              The frozen review revision is unavailable.
            </Alert>
          )}
          <MemberDecisionControls
            member={member}
            decision={getMemberDecision(proposal, user?.id)}
            proposalStatus={proposal.status}
            onApprove={onApprove}
            onReject={onReject}
            isDeciding={savingNote || decidingProposalIds.has(proposal.id)}
          />
          <Box component="details" sx={{ mt: 2 }}>
            <Box component="summary">Written proposal and review details</Box>
            <ProposalGroupMemberReview
              member={member}
              members={group.members}
              decisionProposal={proposal}
              organizationId={group.organizationId}
              projectId={group.projectId}
              onApprove={onApprove}
              onReject={onReject}
              isDeciding={savingNote || decidingProposalIds.has(proposal.id)}
            />
          </Box>
        </DialogContent>
      </FunctionalDialog>
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
  const projection = useMemo<WorkItemGraphProjectionData | null>(() => {
    if (graph?.kind !== "ready") {
      return null;
    }
    const screens = group.members.filter(
      ({ proposal, reservedEntityId }) =>
        reservedEntityId &&
        !isWorkItemGraphProposal(proposal) &&
        isCreateTaskUpdates(proposal) &&
        proposal.updates.type === "mockup",
    );
    const surface = projectWorkItemGraphForWorkflowSurface(graph.projection, {
      organizationId: group.organizationId,
      projectId: group.projectId,
    });
    const liveReferences = surface.steps.flatMap((step) => {
      const reference = getDiagramElementMetadata(step)?.canonicalReference;
      return reference?.entityType === "TASK" &&
        !screens.some(
          ({ reservedEntityId }) => reservedEntityId === reference.entityId,
        )
        ? [reference.entityId]
        : [];
    });
    return {
      ...graph.projection,
      projectedReferenceTargets: Object.fromEntries(
        screens.flatMap(({ proposal, reservedEntityId }) => {
          if (!reservedEntityId || !isCreateTaskUpdates(proposal)) {
            return [];
          }
          return [
            [
              reservedEntityId,
              {
                type: "mockup",
                name: proposal.updates.name,
                sections: proposal.updates.sections,
              },
            ],
          ];
        }),
      ),
      referenceReviewControls: Object.fromEntries([
        ...liveReferences.map((id) => [
          id,
          <SavedScreen key={id} id={id} group={group} />,
        ]),
        ...screens.flatMap((member) =>
          member.reservedEntityId
            ? [
                [
                  member.reservedEntityId,
                  <ScreenControls
                    key={member.memberId}
                    {...props}
                    member={member}
                  />,
                ],
              ]
            : [],
        ),
      ]),
    };
  }, [group, props, graph]);
  if (registry.isLoading) {
    return <CircularProgress aria-label="Loading journey" />;
  }
  if (!projection) {
    return (
      <Alert severity="warning">The journey preview is unavailable. </Alert>
    );
  }
  const directEntityLinks = isWorkItemGraphProposal(props.journey.proposal)
    ? getProposalElementEntityLinks({
        proposal: props.journey.proposal,
        projection,
        siblingProposals: new Map(
          group.members.map(({ proposal }) => [proposal.id, proposal]),
        ),
      })
    : [];
  return (
    <Box data-testid="proposal-group-journey-review">
      <WorkflowGraphSurface
        projection={projection}
        organizationId={group.organizationId}
        projectId={group.projectId}
        presentationState="authored"
        directEntityLinks={directEntityLinks}
        disableLinks
        allowFullscreen
        participation={null}
      />
    </Box>
  );
};
