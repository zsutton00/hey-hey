import { TERMS } from "../../i18n/terminology";
import React from "react";
import { Box } from "@mui/material";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { usePathService } from "../../contexts";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { EntityListItem, EntityGrid } from "../Entity";
import { getWorkItemSectionContent } from "../../utils/workItemSections";
import { getWorkItemCounts } from "../WorkItem/utils";

export interface FeatureListProps {
  features: WorkItemResponseDto[];
  loading?: boolean;
  readOnly?: boolean;
  onDelete?: (feature: WorkItemResponseDto) => void;
  onCreate?: () => void;
  projectId: string;
  organizationId: string;
  emptyMessage?: string;
  showCreateButton?: boolean;
}

export const FeatureList: React.FC<FeatureListProps> = ({
  features,
  loading = false,
  readOnly = false,
  onDelete,
  onCreate,
  projectId,
  organizationId,
  emptyMessage,
  showCreateButton = false,
}) => {
  const pathService = usePathService();
  const featureType = useWorkItemTypeByKey(
    organizationId,
    projectId,
    "FEATURE",
  );

  return (
    <Box
      sx={{
        width: "100%",
        p: 0,
      }}
      data-testid="feature-list"
    >
      <EntityGrid
        items={features}
        loading={loading}
        renderItem={(feature) => {
          const counts = getWorkItemCounts(feature) ?? [];

          return (
            <EntityListItem
              title={feature.name}
              description={getWorkItemSectionContent(
                feature.sections,
                "description",
              )}
              status={feature.status}
              counts={counts}
              href={pathService.feature({ projectId, featureId: feature.id })}
              onDelete={
                onDelete && !readOnly ? () => onDelete(feature) : undefined
              }
            />
          );
        }}
        keyExtractor={(feature) => feature.id}
        emptyMessage={emptyMessage || "No features yet"}
        showCreateButton={showCreateButton}
        onCreateItem={onCreate}
        createAction={{
          verb: "create",
          noun: TERMS.Feature,
          entityType: "feature",
          workItemIcon: {
            typeKey: "FEATURE",
            definition: featureType.workItemTypeDefinition,
          },
        }}
      />
    </Box>
  );
};
