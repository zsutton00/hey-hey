import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import React, { useCallback, useState } from "react";
import { Alert, Box, Button } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { type CreateGoalDto } from "@hey-hey/ui-common/api";
import {
  EntityCollectionPage,
  GoalProgressChip,
  NewGoalModal,
  entityCollectionQueryKeyPrefix,
} from "@hey-hey/ui-common/components";
import {
  useProject,
  useWorkItems,
  useWorkItemTypeByKey,
  type WorkItemResponseDto,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import { usePreviewPresentation } from "../../contexts/PreviewPresentationContext";

export interface GoalsPageProps { organizationId?: string; projectId?: string; preview?: boolean; }

export const GoalsPage: React.FC<GoalsPageProps> = ({ organizationId, projectId: projectIdProp, preview = false }) => {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const { currentOrgId } = useUserIdentity() || {};
  const projectId = projectIdProp ?? routeProjectId;
  const resolvedOrganizationId = organizationId ?? currentOrgId;
  const isPreviewPresentation = usePreviewPresentation();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const { data: project } = useProject(resolvedOrganizationId ?? "", projectId ?? "", {
    enabled: !!resolvedOrganizationId && !!projectId,
  });

  const queryClient = useQueryClient();
  const { workItemTypeDefinition: goalTypeDefinition, error: goalTypeError } =
    useWorkItemTypeByKey(
      resolvedOrganizationId,
      projectId,
      WORK_ITEM_TYPE_KEYS.Goal,
    );

  // Rows are read by EntityCollectionPage; this scope only serves createTask.
  const { createTask } = useWorkItems(
    resolvedOrganizationId ?? "",
    "task",
    projectId ?? "",
    undefined,
    {
      taskType: WORK_ITEM_TYPE_KEYS.Goal,
      parentTaskId: null,
      includeTrackedEntities: false,
      enabled: false,
    },
  );

  const handleCreateGoal = useCallback(
    async (payload: CreateGoalDto): Promise<void> => {
      setIsCreating(true);
      try {
        await createTask({ ...payload, type: WORK_ITEM_TYPE_KEYS.Goal });
        setCreateModalOpen(false);
        if (resolvedOrganizationId && projectId) {
          await queryClient.invalidateQueries({
            queryKey: entityCollectionQueryKeyPrefix(
              resolvedOrganizationId,
              projectId,
              WORK_ITEM_TYPE_KEYS.Goal,
            ),
          });
        }
      } finally {
        setIsCreating(false);
      }
    },
    [createTask, queryClient, resolvedOrganizationId, projectId],
  );

  const renderGoalProgress = useCallback(
    (goal: WorkItemResponseDto) => <GoalProgressChip goal={goal} />,
    [],
  );

  return (
    <>
      {!preview && <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={[
          { label: "Projects", to: "/projects" },
          {
            label: project?.name ?? "Project",
            to: `/projects/${projectId}`,
            type: "project",
          },
          {
            label: t("goals.title", "Goals"),
            to: `/projects/${projectId}/goals`,
            type: "goal",
            isCurrent: true,
          },
        ]}
      />}

      <DetailPageContainer>
        {!isPreviewPresentation && (
          <Box
            display="flex"
            justifyContent="space-between"
            alignItems="center"
            sx={{ mb: 1 }}
          >
          <DetailPageHeader title={t("goals.title", "Goals")} />
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateModalOpen(true)}
            data-testid="create-goal-button"
          >
            {t("goals.createGoal", "Create Goal")}
          </Button>
          </Box>
        )}

        {goalTypeError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {goalTypeError.message ?? t("goals.loadError", "Failed to load goals")}
          </Alert>
        )}

        <EntityCollectionPage
          organizationId={resolvedOrganizationId ?? ""}
          projectId={projectId ?? ""}
          typeDefinition={goalTypeDefinition}
          includeTrackedWorkSummary
          renderRowAttention={renderGoalProgress}
          emptyMessage={t("goals.empty", "No goals yet.")}
          searchPlaceholder={t("goals.search", "Search goals")}
        />

        <NewGoalModal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          onSubmit={handleCreateGoal}
          isLoading={isCreating}
        />
      </DetailPageContainer>
    </>
  );
};
