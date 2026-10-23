import {
  type ContextRelatedEntityDto,
  type EntityContextDtoProposalsInner,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import { Card, isVisualArtifactTypeKey } from "@hey-hey/ui-common/components";
import { useWorkItemTypes } from "@hey-hey/ui-common/data";
import { Box, List, Stack, Typography } from "@mui/material";
import React, { useMemo } from "react";

import {
  DEPENDS_ON_RELATIONSHIP,
  type MergedEntityRow,
  RailCardBody,
  SectionHeader,
  renderEntityRow,
  renderUserRow,
  useMergedRelatedRows,
} from "./relatedRows";

interface RelatedCardProps {
  proposals: EntityContextDtoProposalsInner[];
  relatedEntities: ContextRelatedEntityDto[];
  organizationId: string;
  projectId: string;
  dataTestId?: string;
  loading?: boolean;
}

/**
 * Edge-driven relationships only. Origin, Last Updated, and Created Together
 * render in the History card; Mockups and Diagrams render as visual cards.
 */
export const RelatedCard: React.FC<RelatedCardProps> = ({
  proposals,
  relatedEntities,
  organizationId,
  projectId,
  dataTestId = "related-card",
  loading = false,
}) => {
  const { workItemTypes } = useWorkItemTypes(organizationId, { projectId });
  const { designDocRows, taskBuckets, otherRows, userInfluenceRows } =
    useMergedRelatedRows(proposals ?? [], relatedEntities);

  // Order the task groups by the work-item-types snapshot: one section per
  // type the registry knows about whose bucket is non-empty, titled from the
  // type definition. Buckets whose type key is not in the snapshot trail under
  // their raw key so unknown or just-created types still surface.
  const taskGroups = useMemo<
    { typeKey: string; title: string; rows: MergedEntityRow[] }[]
  >(() => {
    const groups: {
      typeKey: string;
      title: string;
      rows: MergedEntityRow[];
    }[] = [];
    const seen = new Set<string>();
    const prioritizeDependencies = (
      rows: MergedEntityRow[]
    ): MergedEntityRow[] => [
      ...rows.filter((row) =>
        row.relationships.includes(DEPENDS_ON_RELATIONSHIP)
      ),
      ...rows.filter(
        (row) => !row.relationships.includes(DEPENDS_ON_RELATIONSHIP)
      ),
    ];
    const visibleBuckets = new Map(
      Array.from(taskBuckets).filter(
        ([typeKey]) => !isVisualArtifactTypeKey(typeKey)
      )
    );

    for (const type of workItemTypes) {
      const typeKey = type.definition.key;
      if (seen.has(typeKey)) continue;
      const rows = visibleBuckets.get(typeKey);
      if (rows && rows.length > 0) {
        groups.push({
          typeKey,
          title: type.definition.name,
          rows: prioritizeDependencies(rows),
        });
        seen.add(typeKey);
      }
    }

    for (const [typeKey, rows] of visibleBuckets) {
      if (seen.has(typeKey) || rows.length === 0) continue;
      groups.push({
        typeKey,
        title: typeKey,
        rows: prioritizeDependencies(rows),
      });
    }

    return groups;
  }, [workItemTypes, taskBuckets]);

  const workItemTypeDefinitions = useMemo<
    ReadonlyMap<string, WorkItemTypeDefinitionDto>
  >(
    () =>
      new Map(
        workItemTypes.map(({ definition }) => [definition.key, definition])
      ),
    [workItemTypes]
  );

  const hasDesignDocs = designDocRows.length > 0;
  const hasTasks = taskGroups.length > 0;
  const hasOther = otherRows.length > 0 || userInfluenceRows.length > 0;
  const isEmpty = !hasDesignDocs && !hasTasks && !hasOther;

  const testIdPrefix = `${dataTestId}-row`;
  const renderRow = (row: MergedEntityRow) =>
    renderEntityRow(
      row,
      projectId,
      testIdPrefix,
      workItemTypeDefinitions,
      workItemTypes
    );

  return (
    <Card title="Related" dataTestId={dataTestId}>
      <Stack spacing={1.25} sx={{ minWidth: 0 }}>
        <RailCardBody
          loading={loading}
          dataTestId={dataTestId}
          loadingLabel="Loading related entities"
        >
          {isEmpty ? (
            <Typography variant="body2" color="text.secondary">
              No related entities.
            </Typography>
          ) : (
            <Stack spacing={1.5} sx={{ minWidth: 0 }}>
              {hasDesignDocs && (
                <Box data-testid={`${dataTestId}-section-design-documents`}>
                  <SectionHeader title="Design Documents" />
                  <List dense disablePadding>
                    {designDocRows.map(renderRow)}
                  </List>
                </Box>
              )}
              {taskGroups.map((group) => (
                <Box
                  key={group.typeKey}
                  data-testid={`${dataTestId}-section-${group.typeKey.toLowerCase()}`}
                >
                  <SectionHeader title={group.title} />
                  <List dense disablePadding>
                    {group.rows.map(renderRow)}
                  </List>
                </Box>
              ))}
              {hasOther && (
                <Box data-testid={`${dataTestId}-section-other`}>
                  <SectionHeader title="Other" />
                  <List dense disablePadding>
                    {otherRows.map(renderRow)}
                    {userInfluenceRows.map((user) =>
                      renderUserRow(user, projectId, testIdPrefix)
                    )}
                  </List>
                </Box>
              )}
            </Stack>
          )}
        </RailCardBody>
      </Stack>
    </Card>
  );
};

RelatedCard.displayName = "RelatedCard";
