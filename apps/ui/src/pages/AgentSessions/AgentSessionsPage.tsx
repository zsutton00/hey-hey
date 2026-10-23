import {
  AgentSessionsList,
  InitiativeSelector,
  TaskSelector,
} from "@hey-hey/ui-common/components";
import { EntityType } from "@hey-hey/ui-common/api";
import { useProject } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { compose } from "@hey-hey/ui-common/i18n";
import { Box, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useQueryState, parseAsString } from "nuqs";
import { PageBreadcrumbs } from "../../components/Layout";

export const AgentSessionsPage: React.FC = () => {
  const { t } = useTranslation();
  const { projectId } = useParams<{ projectId: string }>();
  const { currentOrgId } = useUserIdentity() || {};

  const { data: project } = useProject(currentOrgId || "", projectId || "", {
    enabled: !!currentOrgId && !!projectId,
    preferStale: true,
  });

  // Filter state managed via URL query parameters
  const [selectedInitiativeId, setSelectedInitiativeId] = useQueryState(
    "initiative",
    parseAsString
  );
  const [selectedTaskId, setSelectedTaskId] = useQueryState(
    "task",
    parseAsString
  );

  // Handle initiative change - clear task when initiative changes
  const handleInitiativeChange = (initiativeId: string | null) => {
    setSelectedInitiativeId(initiativeId);
    setSelectedTaskId(null);
  };

  if (!projectId || !currentOrgId) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>{t("common.loading")}...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }} data-testid="agent-sessions">
      {/* Breadcrumbs */}
      <PageBreadcrumbs
        sx={{ mb: 3 }}
        items={[
          { label: "Projects", to: "/projects" },
          {
            label: project?.name ?? compose("{{term.Project}}"),
            to: `/projects/${projectId}`,
            type: project?.name ? "project" : undefined,
          },
          {
            label: t("codingSessions.title", "Coding Sessions"),
            isCurrent: true,
          },
        ]}
      />

      {/* Page Header */}
      <Typography variant="h4" sx={{ mb: 3 }}>
        {t("codingSessions.title", "Coding Sessions")}
      </Typography>

      {/* Filters Section */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap" }}>
          <InitiativeSelector
            organizationId={currentOrgId}
            projectId={projectId}
            value={selectedInitiativeId}
            onChange={handleInitiativeChange}
            placeholder={t(
              "codingSessions.filters.initiativePlaceholder",
              "Filter by initiative",
            )}
            size="small"
          />

          <TaskSelector
            organizationId={currentOrgId}
            projectId={projectId}
            value={selectedTaskId}
            onChange={(taskId) => setSelectedTaskId(taskId)}
            placeholder={t(
              "codingSessions.filters.taskPlaceholder",
              "Filter by task",
            )}
            size="small"
          />
        </Stack>
      </Paper>

      {/* Coding Sessions List */}
      <AgentSessionsList
        organizationId={currentOrgId}
        projectId={projectId}
        entityType={
          selectedTaskId
            ? EntityType.Task
            : selectedInitiativeId
            ? EntityType.Initiative
            : undefined
        }
        entityId={selectedTaskId ?? selectedInitiativeId ?? undefined}
      />
    </Box>
  );
};
