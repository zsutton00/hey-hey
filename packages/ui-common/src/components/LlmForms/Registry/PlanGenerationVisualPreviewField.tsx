import { Alert, CircularProgress, Stack, Typography } from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import type {
  PlanGenerationVisualPreviewEntry,
  PlanGenerationVisualPreviewPayload,
  ProposalResponseDto,
} from "../../../api";
import { ProposalAction } from "../../../api";
import { proposalsClient } from "../../../clients/serviceClients";
import { useMessageProposalActions } from "../../Conversation/Components/MessageProposals";
import { FutureProposalReview } from "../../ProposalDetail/FutureProposalReview";
import {
  CreateProposal,
  DeleteProposal,
  ProposalStepper,
  UpdateProposal,
} from "../../ProposalDispatchers";
import { useProposalState } from "../../ProposalDispatchers/useProposalState";
import { ProposalPresentationContext } from "../../ProposalDispatchers/ProposalPresentationContext";
import { getProposalDisplayTitle } from "../../ProposalDispatchers/getProposalDisplayTitle";
import { renderMentionNode } from "../../shared/WorkflowMentionInlineRenderer";
import { useWorkItem } from "../../../data/hooks/useWorkItem";
import type {
  CreateProposalProps,
  UpdateProposalProps,
} from "../../ProposalDispatchers";
import type { ConversationMessage } from "../../../types/conversation";
import type { FieldComponentProps } from "./types";
import {
  isPlanGenerationVisualPreviewPayload,
  resolvePlanGenerationVisualPreview,
  resolveVisualEntryPresentation,
  type ResolvedPlanGenerationVisualPreviewEntry,
} from "./planGenerationVisualPreviewUtils";

export type PlanGenerationVisualPreviewFieldProps = FieldComponentProps & {
  conversationMessage: ConversationMessage;
};

const VisualProposalCard: React.FC<{
  proposal: ProposalResponseDto;
  allProposals: ProposalResponseDto[];
  disabled: boolean;
  onApply: CreateProposalProps["onApply"];
  onReject: CreateProposalProps["onReject"];
  onApplied: CreateProposalProps["onApplied"];
  diffDefaultViewMode: UpdateProposalProps["diffDefaultViewMode"];
}> = ({
  proposal,
  allProposals,
  disabled,
  onApply,
  onReject,
  onApplied,
  diffDefaultViewMode,
}) => {
  if (proposal.action === ProposalAction.VersionedUpdate) {
    return (
      <FutureProposalReview
        proposal={proposal}
        onApprove={onApply}
        onReject={onReject}
        onApplied={onApplied}
        disabled={disabled}
      />
    );
  }

  const common = {
    proposals: [proposal],
    onApply,
    onReject,
    disabled,
    allProposals,
  };

  switch (proposal.action) {
    case "CREATE":
      return <CreateProposal {...common} />;
    case "UPDATE":
      return (
        <UpdateProposal
          {...common}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
          diffDefaultViewMode={diffDefaultViewMode}
        />
      );
    case "DELETE":
      return (
        <DeleteProposal
          {...common}
          organizationId={proposal.organizationId}
          projectId={proposal.projectId}
        />
      );
    default:
      return (
        <Alert severity="warning">
          This visual proposal action is not supported.
        </Alert>
      );
  }
};

/**
 * Renders an approved reused visual as its Mockup or Diagram content. The
 * proposal card is the fallback while the work item cannot be resolved, so the
 * visual never drops out of the ordered set.
 */
const ApprovedVisualContent: React.FC<{
  entityId: string;
  artifactFamily: PlanGenerationVisualPreviewEntry["artifactFamily"];
  organizationId: string;
  projectId: string;
  fallback: React.ReactNode;
}> = ({ entityId, artifactFamily, organizationId, projectId, fallback }) => {
  const { workItem, isFetched, error } = useWorkItem(
    organizationId,
    "task",
    entityId,
    { projectId },
  );

  if (!isFetched) {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <CircularProgress size={20} />
        <Typography color="text.secondary">Loading visual…</Typography>
      </Stack>
    );
  }
  if (error || !workItem || workItem.id !== entityId) {
    return <>{fallback}</>;
  }

  return (
    <Stack
      data-testid={`plan-generation-visual-preview-content-${entityId}`}
      sx={{ minWidth: 0 }}
    >
      {renderMentionNode({
        entityType: artifactFamily === "diagram" ? "diagram" : workItem.type,
        entityId,
        entityName: workItem.name,
      })}
    </Stack>
  );
};

const StepMetadata: React.FC<{
  entry: PlanGenerationVisualPreviewEntry;
  relatedProposal?: ProposalResponseDto;
}> = ({ entry, relatedProposal }) => (
  <Stack alignItems="center" spacing={0.25}>
    {entry.relationship && relatedProposal && (
      <Typography
        data-testid="plan-generation-visual-preview-relationship"
        variant="caption"
        color="text.secondary"
        sx={{ textAlign: "center" }}
      >
        {entry.relationship.kind === "depends_on" ? "Depends on" : "Refines"}{" "}
        {getProposalDisplayTitle(relatedProposal)}
      </Typography>
    )}
  </Stack>
);

const resolveRelatedProposal = (
  entry: ResolvedPlanGenerationVisualPreviewEntry,
  proposalsById: Map<string, ProposalResponseDto>,
): ProposalResponseDto | undefined =>
  entry.entry.relationship
    ? proposalsById.get(entry.entry.relationship.proposalId)
    : undefined;

type ProposalLoadState =
  | { kind: "idle" | "loading"; proposals: ProposalResponseDto[] }
  | { kind: "ready"; proposals: ProposalResponseDto[] }
  | { kind: "error"; message: string; proposals: ProposalResponseDto[] };

const loadVisualPreviewProposals = async (
  payload: PlanGenerationVisualPreviewPayload,
  organizationId: string,
  projectId: string,
): Promise<ProposalResponseDto[]> => {
  const proposalIds = [
    ...new Set(payload.entries.map((entry) => entry.proposalId)),
  ];
  const proposals = await Promise.all(
    proposalIds.map(async (proposalId) => {
      const response = await proposalsClient.getProposal({
        organizationId,
        projectId,
        proposalId,
      });
      const proposal = response.data?.data;
      if (!proposal) {
        throw new Error("A visual preview proposal could not be loaded.");
      }
      return proposal;
    }),
  );
  return proposals;
};

export const PlanGenerationVisualPreviewField: React.FC<
  PlanGenerationVisualPreviewFieldProps
> = ({
  config,
  context,
  conversationMessage,
  disabled = false,
  isSubmitted,
}) => {
  const visualPayload = useMemo(
    () =>
      isPlanGenerationVisualPreviewPayload(config.payload)
        ? config.payload
        : undefined,
    [config.payload],
  );
  const proposalIdsKey = useMemo(
    () =>
      visualPayload?.entries.map((entry) => entry.proposalId).join(",") ?? "",
    [visualPayload],
  );
  const [proposalLoad, setProposalLoad] = useState<ProposalLoadState>({
    kind: "idle",
    proposals: [],
  });
  const [proposalRefreshVersion, setProposalRefreshVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!visualPayload) {
      setProposalLoad({ kind: "idle", proposals: [] });
      return () => {
        cancelled = true;
      };
    }

    setProposalLoad({ kind: "loading", proposals: [] });
    void loadVisualPreviewProposals(
      visualPayload,
      context.organizationId,
      context.projectId,
    )
      .then((proposals) => {
        if (!cancelled) {
          setProposalLoad({ kind: "ready", proposals });
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setProposalLoad({
            kind: "error",
            message:
              loadError instanceof Error
                ? loadError.message
                : "A visual preview proposal could not be loaded.",
            proposals: [],
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    context.organizationId,
    context.projectId,
    visualPayload,
    proposalIdsKey,
    proposalRefreshVersion,
  ]);

  const ungroupedProposals = useMemo(
    () =>
      proposalLoad.proposals.filter((proposal) => !proposal.groupMembership),
    [proposalLoad.proposals],
  );
  const resolution = useMemo(
    () =>
      proposalLoad.kind === "ready"
        ? resolvePlanGenerationVisualPreview(
            visualPayload,
            proposalLoad.proposals,
          )
        : proposalLoad.kind === "error"
          ? { kind: "error" as const, message: proposalLoad.message }
          : { kind: "loading" as const },
    [proposalLoad, visualPayload],
  );
  const visualEntries = useMemo(
    () => (resolution.kind === "ready" ? resolution.entries : []),
    [resolution],
  );
  const visualProposals = useMemo(
    () => visualEntries.map(({ proposal }) => proposal),
    [visualEntries],
  );
  const { getState } = useProposalState(visualProposals);
  const { handleApply, handleReject, proposalDiffDefaultViewMode } =
    useMessageProposalActions(conversationMessage, ungroupedProposals);
  const proposalsById = useMemo(
    () =>
      new Map<string, ProposalResponseDto>(
        proposalLoad.proposals.map((proposal) => [proposal.id, proposal]),
      ),
    [proposalLoad.proposals],
  );

  return (
    <Stack
      spacing={2}
      data-testid={`plan-generation-visual-preview-${config.field}`}
    >
      <Typography variant="body2" color="text.secondary">
        {config.description}
        {config.required && (
          <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>

      {resolution.kind === "loading" ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <CircularProgress size={20} />
          <Typography color="text.secondary">
            Loading visual plan preview…
          </Typography>
        </Stack>
      ) : resolution.kind === "error" ? (
        <Alert
          data-testid={`plan-generation-visual-preview-error-${config.field}`}
          severity="error"
        >
          {resolution.message}
        </Alert>
      ) : (
        <Stack
          spacing={2}
          data-testid="plan-generation-visual-preview-review"
          sx={{
            border: 2,
            borderColor: "primary.dark",
            borderRadius: 1,
            p: 2,
            minWidth: 0,
          }}
        >
          <Typography variant="h6">Visual plan preview</Typography>
          <ProposalStepper
            proposals={visualProposals}
            getItemState={getState}
            onApply={handleApply}
            hideHeaderMetadata
            getStepMetadata={(proposal) => {
              const resolvedEntry = visualEntries.find(
                ({ proposal: entryProposal }) =>
                  entryProposal.id === proposal.id,
              );
              if (!resolvedEntry) return null;
              return (
                <StepMetadata
                  entry={resolvedEntry.entry}
                  relatedProposal={resolveRelatedProposal(
                    resolvedEntry,
                    proposalsById,
                  )}
                />
              );
            }}
            renderProposal={(proposal) => {
              const card = (
                <ProposalPresentationContext.Provider
                  value={disabled || isSubmitted ? "read-only" : "actionable"}
                >
                  <VisualProposalCard
                    proposal={proposal}
                    allProposals={ungroupedProposals}
                    disabled={disabled || isSubmitted}
                    onApply={handleApply}
                    onReject={handleReject}
                    onApplied={() =>
                      setProposalRefreshVersion((version) => version + 1)
                    }
                    diffDefaultViewMode={proposalDiffDefaultViewMode}
                  />
                </ProposalPresentationContext.Provider>
              );
              const resolvedEntry = visualEntries.find(
                ({ proposal: entryProposal }) =>
                  entryProposal.id === proposal.id,
              );
              const presentation = resolvedEntry
                ? resolveVisualEntryPresentation(resolvedEntry)
                : { kind: "proposal" as const };
              return presentation.kind === "content" ? (
                <ApprovedVisualContent
                  entityId={presentation.entityId}
                  artifactFamily={presentation.artifactFamily}
                  organizationId={context.organizationId}
                  projectId={context.projectId}
                  fallback={card}
                />
              ) : (
                card
              );
            }}
          />
        </Stack>
      )}
    </Stack>
  );
};
