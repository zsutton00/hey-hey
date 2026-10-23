import { WebPathService } from "@hey-hey/ui-common";
import { TaskMonitorActivityTab } from "@hey-hey/ui-common/components";
import { Box } from "@mui/material";
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
import { CostsView, UsageView } from "./views";

const projectAgentsViews = [
  "agent-sessions",
  "conversations",
  "automation",
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
          segments={projectAgentsSegments}
          value={displayedView}
          onChange={(value) =>
            void setAgentsView(value, { history: "push" })
          }
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
