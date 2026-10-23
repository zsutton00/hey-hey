import type {
  ContextRelatedEntityDto,
  EntityContextDtoProposalsInner,
} from "@hey-hey/ui-common/api";
import { Card } from "@hey-hey/ui-common/components";
import { Box, CircularProgress, Stack, Typography } from "@mui/material";
import React, { Suspense, lazy, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { DetailPageSidebar } from "../../components/Layout";
import { ContextRailCards } from "../../components/ContextRailCards";
import type { BreadcrumbFeatureAncestor } from "../../components/TaskBreadcrumbs";

const FeatureTreeVisualization = lazy(
  () => import("@hey-hey/ui-common/feature-tree-visualization")
);

interface TaskDetailSidebarProps {
  organizationId: string;
  projectId: string;
  /** The page's work item, whose Mockup and Diagram children get visual cards. */
  workItemId?: string;
  /** Resolved structural feature ancestors, root-first. */
  featureAncestors: readonly BreadcrumbFeatureAncestor[];
  relatedEntities: ContextRelatedEntityDto[];
  proposals?: EntityContextDtoProposalsInner[];
}

export const TaskDetailSidebar: React.FC<TaskDetailSidebarProps> = ({
  organizationId,
  projectId,
  workItemId,
  featureAncestors,
  relatedEntities,
  proposals,
}) => {
  const { t } = useTranslation();

  const parentFeatureId = featureAncestors.at(-1)?.id;

  const conversationPathForId = useCallback(
    (conversationId: string) =>
      `/projects/${projectId}/resolve-agent-session/${conversationId}`,
    [projectId]
  );

  const featureTreeCard = (
    <Card
      title={t("features.featureTree", "Feature Tree")}
      dataTestId="task-sidebar-feature-tree-card"
    >
      <Stack spacing={1.25} sx={{ minWidth: 0 }}>
        {parentFeatureId ? (
          <Box
            sx={{
              position: "relative",
              width: "100%",
              overflowX: "auto",
              overflowY: "hidden",
            }}
          >
            <Suspense fallback={<CircularProgress />}>
              <FeatureTreeVisualization
                organizationId={organizationId}
                projectId={projectId}
                dataSource="local-neighborhood"
                focusedFeatureId={parentFeatureId}
                activeFeatureId={parentFeatureId}
                fillHeight={false}
              />
            </Suspense>
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No parent features.
          </Typography>
        )}
      </Stack>
    </Card>
  );

  return (
    <DetailPageSidebar
      navigation={null}
      metadata={
        <Stack spacing={2}>
          {featureTreeCard}
          <ContextRailCards
            proposals={proposals ?? []}
            relatedEntities={relatedEntities}
            organizationId={organizationId}
            projectId={projectId}
            conversationPathForId={conversationPathForId}
            parentWorkItemId={workItemId}
            dataTestIdPrefix="task-sidebar"
          />
        </Stack>
      }
    />
  );
};

TaskDetailSidebar.displayName = "TaskDetailSidebar";
