import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import React, { useMemo } from "react";
import {
  ActivityCorrelationLinkType,
  type ActivityCorrelationLinkedEntityDto,
} from "../../api";

interface ActivityRelationshipGroup {
  parents: ActivityCorrelationLinkedEntityDto[];
  children: ActivityCorrelationLinkedEntityDto[];
  siblings: ActivityCorrelationLinkedEntityDto[];
  blocks: ActivityCorrelationLinkedEntityDto[];
  dependsOn: ActivityCorrelationLinkedEntityDto[];
  related: ActivityCorrelationLinkedEntityDto[];
}

export interface ActivityTaskRelationshipsProps {
  originTitle: string;
  linkedEntities: ActivityCorrelationLinkedEntityDto[];
  emptyMessage?: string;
  testIdPrefix?: string;
}

const createEmptyRelationshipGroup = (): ActivityRelationshipGroup => ({
  parents: [],
  children: [],
  siblings: [],
  blocks: [],
  dependsOn: [],
  related: [],
});

const categorizeLinkedEntities = (
  linkedEntities: ActivityCorrelationLinkedEntityDto[]
): ActivityRelationshipGroup => {
  const grouped = createEmptyRelationshipGroup();

  linkedEntities.forEach((entity) => {
    switch (entity.linkType) {
      case ActivityCorrelationLinkType.Parent:
        grouped.parents.push(entity);
        break;
      case ActivityCorrelationLinkType.Child:
        grouped.children.push(entity);
        break;
      case ActivityCorrelationLinkType.Sibling:
        grouped.siblings.push(entity);
        break;
      case ActivityCorrelationLinkType.Blocks:
        grouped.blocks.push(entity);
        break;
      case ActivityCorrelationLinkType.DependsOn:
        grouped.dependsOn.push(entity);
        break;
      case ActivityCorrelationLinkType.Related:
      case ActivityCorrelationLinkType.Self:
        grouped.related.push(entity);
        break;
      default:
        grouped.related.push(entity);
    }
  });

  return grouped;
};

const RelationshipRow: React.FC<{
  label: string;
  entities: ActivityCorrelationLinkedEntityDto[];
  testId: string;
}> = ({ label, entities, testId }) => {
  if (entities.length === 0) {
    return null;
  }

  return (
    <Stack spacing={0.75}>
      <Typography color="text.secondary" variant="caption">
        {label}
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={1}>
        {entities.map((entity) => (
          <Chip
            data-testid={`${testId}-${entity.entityType}-${entity.entityId}`}
            key={`${entity.linkType}-${entity.entityType}-${entity.entityId}`}
            label={entity.title}
            size="small"
            variant="outlined"
          />
        ))}
      </Stack>
    </Stack>
  );
};

export const ActivityTaskRelationships: React.FC<
  ActivityTaskRelationshipsProps
> = ({
  originTitle,
  linkedEntities,
  emptyMessage = "No linked relationships",
  testIdPrefix = "activity-task-relationships",
}) => {
  const groupedRelationships = useMemo(
    () => categorizeLinkedEntities(linkedEntities),
    [linkedEntities]
  );

  const hasRelationships =
    groupedRelationships.parents.length > 0 ||
    groupedRelationships.children.length > 0 ||
    groupedRelationships.siblings.length > 0 ||
    groupedRelationships.blocks.length > 0 ||
    groupedRelationships.dependsOn.length > 0 ||
    groupedRelationships.related.length > 0;

  return (
    <Paper data-testid={testIdPrefix} sx={{ p: 1.5 }} variant="outlined">
      <Stack spacing={1.25}>
        <Typography variant="subtitle2">Task Relationships</Typography>

        <Box>
          <Typography color="text.secondary" variant="caption">
            Origin
          </Typography>
          <Typography data-testid={`${testIdPrefix}-origin`} variant="body2">
            {originTitle}
          </Typography>
        </Box>

        {!hasRelationships ? (
          <Typography
            color="text.secondary"
            data-testid={`${testIdPrefix}-empty`}
            variant="body2"
          >
            {emptyMessage}
          </Typography>
        ) : (
          <Stack spacing={1.25}>
            <RelationshipRow
              entities={groupedRelationships.parents}
              label="Parent"
              testId={`${testIdPrefix}-parent`}
            />
            <RelationshipRow
              entities={groupedRelationships.children}
              label="Children"
              testId={`${testIdPrefix}-child`}
            />
            <RelationshipRow
              entities={groupedRelationships.siblings}
              label="Siblings"
              testId={`${testIdPrefix}-sibling`}
            />
            <RelationshipRow
              entities={groupedRelationships.blocks}
              label="Blocking"
              testId={`${testIdPrefix}-blocks`}
            />
            <RelationshipRow
              entities={groupedRelationships.dependsOn}
              label="Blocked By"
              testId={`${testIdPrefix}-depends-on`}
            />
            <RelationshipRow
              entities={groupedRelationships.related}
              label="Related"
              testId={`${testIdPrefix}-related`}
            />
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};
