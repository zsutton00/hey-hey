import { WebPathService } from "@hey-hey/ui-common";
import { TaskMonitorActivityTab } from "@hey-hey/ui-common/components";
import { useWorkItemTypes } from "@hey-hey/ui-common/data";
import { Alert, Box } from "@mui/material";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import React, { useCallback, useRef } from "react";
import {
  PaginatedCodingSessionsFeed,
  PaginatedSessionFeed,
} from "../../components/Activity";
import {
  SegmentedToggle,
  type Segment,
} from "../../components/SegmentedToggle";
import { buildPlanTaskMonitorPath } from "../Plan/planSessionRoutes";
import { ProjectWorkItemsTab } from "../../components/Tabs/ProjectWorkItemsTab";
import { selectProjectEvalType } from "./projectEvalDiscovery";
import { CostsView, UsageView } from "./views";

const projectAgentsViews = [
  "agent-sessions",
  "conversations",
  "automation",
  "evals",
  "costs",
  "usage",
] as const;
type ProjectAgentsView = (typeof projectAgentsViews)[number];

const projectAgentsSegments: readonly Segment<ProjectAgentsView>[] = [
  { value: "agent-sessions", label: "Agent Sessions" },
  { value: "conversations", label: "Conversations" },
  { value: "automation", label: "Automation" },
  { value: "costs", label: "Costs" },
  { value: "usage", label: "Usage" },
];

export interface ProjectAgentsTabProps {
  organizationId: string;
  projectId: string;
  userId: string;
}

export const ProjectAgentsTab: React.FC<ProjectAgentsTabProps> = ({
  organizationId,
  projectId,
  userId,
}) => {
  const { workItemTypes, isReady, error } = useWorkItemTypes(organizationId, {
    projectId,
  });
  const evalType = selectProjectEvalType(workItemTypes, projectId, isReady);
  const segments: readonly Segment<ProjectAgentsView>[] = evalType
    ? [
        ...projectAgentsSegments.slice(0, 3),
        { value: "evals", label: evalType.definition.name },
        ...projectAgentsSegments.slice(3),
      ]
    : projectAgentsSegments;
  const [agentsView, setAgentsView] = useQueryState(
    "agentsSubTab",
    parseAsStringLiteral(projectAgentsViews).withDefault("agent-sessions"),
  );
  const activeView: ProjectAgentsView = projectAgentsViews.includes(
    agentsView as ProjectAgentsView,
  )
    ? (agentsView as ProjectAgentsView)
    : "agent-sessions";
  const isLeavingProjectRef = useRef(false);
  const displayedViewRef = useRef(activeView);
  if (!isLeavingProjectRef.current) {
    displayedViewRef.current = activeView;
  }
  const displayedView = displayedViewRef.current;

  const handleSessionNavigate = useCallback(() => {
    isLeavingProjectRef.current = true;
  }, []);

  return (
    <Box data-testid="project-agents-tab" sx={{ mt: 2 }}>
      <Box sx={{ mb: 3, maxWidth: "100%", minWidth: 0 }}>
        <SegmentedToggle
          segments={segments}
          value={displayedView === "evals" && !evalType ? "" : displayedView}
          onChange={(value) => {
            if (value) void setAgentsView(value, { history: "push" });
          }}
          mobileDropdown
        />
      </Box>
      {displayedView === "agent-sessions" && (
        <PaginatedCodingSessionsFeed
          limit={10}
          onSessionNavigate={handleSessionNavigate}
          organizationId={organizationId}
          projectId={projectId}
        />
      )}
      {displayedView === "conversations" && (
        <PaginatedSessionFeed
          limit={10}
          onSessionNavigate={handleSessionNavigate}
          organizationId={organizationId}
          projectId={projectId}
          variant="conversations"
        />
      )}
      {displayedView === "automation" && (
        <TaskMonitorActivityTab
          buildTaskMonitorPath={(target) => {
            switch (target.kind) {
              case "plan":
                return buildPlanTaskMonitorPath(
                  projectId,
                  target.planId,
                  undefined,
                  target.taskId,
                );
              case "task":
                return WebPathService.task({
                  projectId,
                  taskId: target.taskId,
                });
            }
          }}
          organizationId={organizationId}
          projectId={projectId}
        />
      )}
      {displayedView === "evals" &&
        (evalType ? (
          <ProjectWorkItemsTab
            key={`${organizationId}:${projectId}:${evalType.definition.key}`}
            organizationId={organizationId}
            projectId={projectId}
            taskType={evalType.definition.key}
            title={evalType.definition.name}
            emptyMessage="No evaluations found."
          />
        ) : (
          <Alert severity={!isReady && !error ? "info" : "warning"}>
            {!isReady && !error
              ? "Loading evaluations…"
              : "Evaluations are unavailable for this project."}
          </Alert>
        ))}
      {displayedView === "costs" && (
        <CostsView
          organizationId={organizationId}
          projectId={projectId}
          userId={userId}
        />
      )}
      {displayedView === "usage" && (
        <UsageView
          organizationId={organizationId}
          projectId={projectId}
          userId={userId}
        />
      )}
    </Box>
  );
};
