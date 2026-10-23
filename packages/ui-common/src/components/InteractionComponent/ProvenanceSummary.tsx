import React from "react";
import { Box, Link, Typography } from "@mui/material";
import { EntityType } from "../../api";
import type { ContextProposalSummaryDto, Influence } from "../../api";

export type EntityProposalHistoryEntry = Pick<
  ContextProposalSummaryDto,
  "id" | "action" | "status" | "createdAt" | "influences" | "conversationId"
>;

/**
 * Entity types that the parent InteractionComponent's navigation callback
 * knows how to route. Anything outside this set renders as plain text.
 */
const NAVIGABLE_ENTITY_TYPES = new Set<EntityType>([
  EntityType.Task,
  EntityType.DesignDoc,
  EntityType.Initiative,
  EntityType.AgentSession,
]);

const ENTITY_TYPE_LABEL: Record<string, string> = {
  ARTIFACT: "Artifact",
  INITIATIVE: "Initiative",
  PROJECT: "Project",
  TASK: "Task",
  MESSAGE: "Message",
  CONVERSATION: "Conversation",
  DESIGN_DOC: "Design Doc",
  AGENT_SESSION: "Agent Session",
  CODING_PROMPT: "Coding Prompt",
  VALIDATION_SESSION: "Validation Session",
  SERVICE: "Service",
  PLAN: "Plan",
  REPORT: "Report",
  PROPOSAL: "Proposal",
  PLAN_STAGE: "Plan Stage",
  PLAN_STEP: "Plan Step",
  IMPLEMENTATION_HINT: "Implementation Hint",
};

const labelForEntityType = (type: string): string =>
  ENTITY_TYPE_LABEL[type] ?? type;

/** Most recent (by createdAt) APPROVED proposal whose action matches. */
const findLatestApproved = (
  proposals: EntityProposalHistoryEntry[],
  action: EntityProposalHistoryEntry["action"]
): EntityProposalHistoryEntry | undefined => {
  let latest: EntityProposalHistoryEntry | undefined;
  for (const p of proposals) {
    if (p.status !== "APPROVED" || p.action !== action) continue;
    if (!latest || new Date(p.createdAt) > new Date(latest.createdAt)) {
      latest = p;
    }
  }
  return latest;
};

/** First (chronologically earliest) APPROVED proposal whose action matches. */
const findEarliestApproved = (
  proposals: EntityProposalHistoryEntry[],
  action: EntityProposalHistoryEntry["action"]
): EntityProposalHistoryEntry | undefined => {
  let earliest: EntityProposalHistoryEntry | undefined;
  for (const p of proposals) {
    if (p.status !== "APPROVED" || p.action !== action) continue;
    if (!earliest || new Date(p.createdAt) < new Date(earliest.createdAt)) {
      earliest = p;
    }
  }
  return earliest;
};

export const selectCreatedProposal = (
  proposals: EntityProposalHistoryEntry[] | undefined
): EntityProposalHistoryEntry | undefined =>
  proposals?.length ? findEarliestApproved(proposals, "CREATE") : undefined;

export const selectLastUpdatedProposal = (
  proposals: EntityProposalHistoryEntry[] | undefined
): EntityProposalHistoryEntry | undefined =>
  proposals?.length ? findLatestApproved(proposals, "UPDATE") : undefined;

const findOriginInfluence = (
  proposal: EntityProposalHistoryEntry
): Influence | undefined =>
  proposal.influences?.find((i) => i.reasonType === "origin");

export interface ProvenanceSummaryProps {
  createdProposal?: EntityProposalHistoryEntry;
  lastUpdatedProposal?: EntityProposalHistoryEntry;
  onNavigateToEntity: (entityId: string, entityType: EntityType) => void;
  onNavigateToConversation: (conversationId: string) => void;
  onClose: () => void;
}

interface ProvenanceRowProps {
  label: string;
  proposal: EntityProposalHistoryEntry;
  onNavigateToEntity: (entityId: string, entityType: EntityType) => void;
  onNavigateToConversation: (conversationId: string) => void;
  onClose: () => void;
  testIdPrefix: string;
}

const ProvenanceRow: React.FC<ProvenanceRowProps> = ({
  label,
  proposal,
  onNavigateToEntity,
  onNavigateToConversation,
  onClose,
  testIdPrefix,
}) => {
  const origin = findOriginInfluence(proposal);
  const conversationId = proposal.conversationId;
  const originType = origin?.entityType as EntityType | undefined;
  const isOriginNavigable =
    !!originType && NAVIGABLE_ENTITY_TYPES.has(originType);

  return (
    <Box data-testid={testIdPrefix} sx={{ px: 2, py: 1 }}>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          fontSize: "0.7rem",
          color: "text.secondary",
          display: "block",
          mb: 0.5,
        }}
      >
        {label}
      </Typography>
      <Typography variant="caption" sx={{ display: "block", p: "4px" }}>
        {conversationId && (
          <>
            via{" "}
            <Link
              component="button"
              variant="caption"
              underline="hover"
              data-testid={`${testIdPrefix}-conversation-link`}
              onClick={() => {
                onNavigateToConversation(conversationId);
                onClose();
              }}
              sx={{ cursor: "pointer", verticalAlign: "baseline" }}
            >
              Conversation
            </Link>
          </>
        )}
        {conversationId && origin && " "}
        {origin && (
          <>
            about{" "}
            {isOriginNavigable ? (
              <Link
                component="button"
                variant="caption"
                underline="hover"
                data-testid={`${testIdPrefix}-entity-link`}
                onClick={() => {
                  onNavigateToEntity(
                    origin.entityId,
                    origin.entityType as EntityType
                  );
                  onClose();
                }}
                sx={{ cursor: "pointer", verticalAlign: "baseline" }}
              >
                {labelForEntityType(origin.entityType)}
              </Link>
            ) : (
              <Typography
                component="span"
                variant="caption"
                data-testid={`${testIdPrefix}-entity-text`}
              >
                {labelForEntityType(origin.entityType)}
              </Typography>
            )}
          </>
        )}
      </Typography>
    </Box>
  );
};

export const ProvenanceSummary: React.FC<ProvenanceSummaryProps> = ({
  createdProposal,
  lastUpdatedProposal,
  onNavigateToEntity,
  onNavigateToConversation,
  onClose,
}) => {
  if (!createdProposal && !lastUpdatedProposal) return null;

  return (
    <Box data-testid="provenance-summary">
      {createdProposal && (
        <ProvenanceRow
          label="Created"
          proposal={createdProposal}
          onNavigateToEntity={onNavigateToEntity}
          onNavigateToConversation={onNavigateToConversation}
          onClose={onClose}
          testIdPrefix="provenance-created"
        />
      )}
      {lastUpdatedProposal && (
        <ProvenanceRow
          label="Last Updated"
          proposal={lastUpdatedProposal}
          onNavigateToEntity={onNavigateToEntity}
          onNavigateToConversation={onNavigateToConversation}
          onClose={onClose}
          testIdPrefix="provenance-last-updated"
        />
      )}
    </Box>
  );
};
