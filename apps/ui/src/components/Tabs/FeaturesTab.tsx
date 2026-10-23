import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import React, { useState, useCallback } from "react";
import { Box, Button, Stack } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useTranslation } from "react-i18next";
import {
  WorkItemTypeLifecycleStatus,
  type CreateFeatureDto,
} from "@hey-hey/ui-common/api";
import { FeatureList, NewFeatureModal } from "@hey-hey/ui-common/components";
import { useWorkItems, useWorkItemTypeByKey } from "@hey-hey/ui-common/data";
import { CardHeader } from "../CardHeader";
import { TabContainer } from "./TabContainer";

export interface FeaturesTabProps {
  organizationId: string;
  projectId: string;
}

export const FeaturesTab: React.FC<FeaturesTabProps> = ({
  organizationId,
  projectId,
}) => {
  const { t } = useTranslation();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const { workItemTypeSummary: featureTypeSummary, isFetched: isTypeFetched } =
    useWorkItemTypeByKey(
      organizationId,
      projectId,
      WORK_ITEM_TYPE_KEYS.Feature,
    );
  const canCreateFeature =
    isTypeFetched &&
    featureTypeSummary?.status === WorkItemTypeLifecycleStatus.Active &&
    featureTypeSummary.projectId === projectId;

  const { workItems, isLoading, createTask } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      taskType: WORK_ITEM_TYPE_KEYS.Feature,
      includeSectionKeys: ["description"],
    },
  );

  const features = workItems;

  const handleCreateFeature = useCallback(
    async (formData: CreateFeatureDto): Promise<void> => {
      setIsCreating(true);
      try {
        await createTask({ ...formData, type: WORK_ITEM_TYPE_KEYS.Feature });
        setCreateModalOpen(false);
      } finally {
        setIsCreating(false);
      }
    },
    [createTask],
  );

  return (
    <TabContainer>
      <Stack spacing={3}>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <CardHeader title={t("features.title", "Features")} />
          {canCreateFeature ? (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setCreateModalOpen(true)}
              data-testid="create-feature-button"
            >
              {t("features.createFeature", "Create Feature")}
            </Button>
          ) : null}
        </Box>

        {!isLoading && features.length === 0 && (
          <Box
            sx={{
              textAlign: "center",
              py: 6,
              color: "text.secondary",
            }}
            data-testid="features-empty-state"
          >
            {t(
              "features.empty",
              "No features yet. Create your first feature to get started.",
            )}
          </Box>
        )}

        {features.length > 0 && (
          <Stack spacing={1} data-testid="features-list">
            <FeatureList
              features={features}
              projectId={projectId}
              organizationId={organizationId}
            />
          </Stack>
        )}

        {canCreateFeature ? (
          <NewFeatureModal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            onSubmit={handleCreateFeature}
            isLoading={isCreating}
          />
        ) : null}
      </Stack>
    </TabContainer>
  );
};
