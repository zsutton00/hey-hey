import {
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import { Card } from "@hey-hey/ui-common/components";
import { useWorkItemTypes } from "@hey-hey/ui-common/data";
import { Box, List, Stack, Typography } from "@mui/material";
import React, { useMemo } from "react";

import {
  SectionHeader,
  findAboutFromProposal,
  findLastUpdateProposal,
  findOriginProposal,
  formatTimeAgo,
  renderEntityRow,
  renderProposalRow,
  useMergedRelatedRows,
} from "../RelatedCard/relatedRows";

interface HistoryCardProps {
  proposals: EntityContextDtoProposalsInner[];
  relatedEntities: ContextRelatedEntityDto[];
  organizationId: string;
  projectId: string;
  conversationPathForId: (conversationId: string) => string;
  dataTestId?: string;
}

/**
 * Where the item came from: the creating conversation, the latest distinct
 * update, and the entities created together with it.
 */
export const HistoryCard: React.FC<HistoryCardProps> = ({
  proposals,
  relatedEntities,
  organizationId,
  projectId,
  conversationPathForId,
  dataTestId = "history-card",
}) => {
  const { workItemTypes } = useWorkItemTypes(organizationId, { projectId });
  const { proposedTogetherRows } = useMergedRelatedRows(
    proposals ?? [],
    relatedEntities
  );

  // Earliest CREATE is the origin; the latest UPDATE is shown only when it
  // came from a different conversation than the origin.
  const originProposal = useMemo(
    () => findOriginProposal(proposals ?? []),
    [proposals]
  );
  const lastUpdateProposal = useMemo(() => {
    const latest = findLastUpdateProposal(proposals ?? []);
    if (!latest) return null;
    if (
      originProposal?.conversationId &&
      latest.conversationId === originProposal.conversationId
    ) {
      return null;
    }
    return latest;
  }, [proposals, originProposal]);

  const workItemTypeDefinitions = useMemo<
    ReadonlyMap<string, WorkItemTypeDefinitionDto>
  >(
    () =>
      new Map(
        workItemTypes.map(({ definition }) => [definition.key, definition])
      ),
    [workItemTypes]
  );

  const isEmpty =
    !originProposal && !lastUpdateProposal && proposedTogetherRows.length === 0;

  const renderConversationRow = (
    proposal: EntityContextDtoProposalsInner,
    verb: "Created" | "Updated",
    testId: string
  ) => {
    const conversationId = proposal.conversationId ?? "";
    const path = conversationId ? conversationPathForId(conversationId) : "#";
    const timeAgo = formatTimeAgo(proposal.createdAt);
    return renderProposalRow(
      proposal,
      path,
      testId,
      timeAgo ? `${verb} ${timeAgo}` : verb,
      findAboutFromProposal(proposal)
    );
  };

  return (
    <Card title="History" dataTestId={dataTestId}>
      <Stack spacing={1.25} sx={{ minWidth: 0 }}>
        {isEmpty ? (
          <Typography variant="body2" color="text.secondary">
            No history.
          </Typography>
        ) : (
          <Stack spacing={1.5} sx={{ minWidth: 0 }}>
            {originProposal && (
              <Box data-testid={`${dataTestId}-section-origin`}>
                <SectionHeader title="Origin" />
                <List dense disablePadding>
                  {renderConversationRow(
                    originProposal,
                    "Created",
                    `${dataTestId}-origin`
                  )}
                </List>
              </Box>
            )}
            {lastUpdateProposal && (
              <Box data-testid={`${dataTestId}-section-last-updated`}>
                <SectionHeader title="Last Updated" />
                <List dense disablePadding>
                  {renderConversationRow(
                    lastUpdateProposal,
                    "Updated",
                    `${dataTestId}-last-updated`
                  )}
                </List>
              </Box>
            )}
            {proposedTogetherRows.length > 0 && (
              <Box data-testid={`${dataTestId}-section-proposed-together`}>
                <SectionHeader title="Created Together" />
                <List dense disablePadding>
                  {proposedTogetherRows.map((row) =>
                    renderEntityRow(
                      row,
                      projectId,
                      `${dataTestId}-row`,
                      workItemTypeDefinitions,
                      workItemTypes
                    )
                  )}
                </List>
              </Box>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
};

HistoryCard.displayName = "HistoryCard";
