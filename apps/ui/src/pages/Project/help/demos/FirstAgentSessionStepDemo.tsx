import React, { useMemo } from "react";
import { Box, Stack } from "@mui/material";

import {
  MINI_DEMO_TARGETS,
  MiniDemoPlayer,
} from "@hey-hey/ui-common/components";
import type { MiniDemoScene } from "@hey-hey/ui-common/components";

import { ExplorerSidebar } from "../../../../components/Explorer/ExplorerSidebar";
import { TaskScopedAgentSessionsTabView } from "../../../../components/Tabs/TaskScopedAgentSessionsTabView";
import { TaskPageView } from "../../../Task/TaskPageView";
import {
  buildTaskAgentSessionsTabViewProps,
  buildTaskPageFixture,
} from "./taskPageFixture";

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;
const SIDEBAR_WIDTH = 260;

interface FirstAgentSessionStepDemoProps {
  organizationId: string;
  projectId: string;
}

interface RealSidebarProps {
  organizationId: string;
  projectId: string;
}

const RealSidebar: React.FC<RealSidebarProps> = ({
  organizationId,
  projectId,
}) => (
  <Box
    aria-hidden
    sx={{
      width: SIDEBAR_WIDTH,
      height: "100%",
      flexShrink: 0,
      pointerEvents: "none",
      overflow: "hidden",
      borderRight: 1,
      borderColor: "divider",
    }}
  >
    <ExplorerSidebar
      organizationId={organizationId}
      projectId={projectId}
      width={SIDEBAR_WIDTH}
      isMinimal={false}
    />
  </Box>
);

type TaskTabSceneProps = RealSidebarProps;

const TaskTabScene: React.FC<TaskTabSceneProps> = (sidebarProps) => {
  const fixture = useMemo(
    () =>
      buildTaskPageFixture(undefined, {
        activeTab: "task",
      }),
    [],
  );
  return (
    <Stack
      direction="row"
      data-demo-scene="task-tab"
      sx={{ width: SCENE_WIDTH, height: SCENE_HEIGHT }}
    >
      <RealSidebar {...sidebarProps} />
      <Box
        data-testid="first-agent-session-step-demo-task-tab"
        sx={{ flex: 1, minWidth: 0, pointerEvents: "none", overflow: "hidden" }}
      >
        <TaskPageView {...fixture} />
      </Box>
    </Stack>
  );
};
TaskTabScene.displayName = "TaskTabScene";

type AgentSessionsSceneProps = RealSidebarProps;

const AgentSessionsScene: React.FC<AgentSessionsSceneProps> = (
  sidebarProps,
) => {
  const fixture = useMemo(() => buildTaskPageFixture(undefined), []);
  const sessionsViewProps = useMemo(
    () =>
      buildTaskAgentSessionsTabViewProps(
        fixture.organizationId,
        fixture.projectId,
        fixture.taskId,
      ),
    [fixture.organizationId, fixture.projectId, fixture.taskId],
  );
  const sceneFixture = useMemo(
    () => ({
      ...fixture,
      activeTab: "agent-sessions" as const,
      agentSessionsTabBody: (
        <TaskScopedAgentSessionsTabView {...sessionsViewProps} />
      ),
    }),
    [fixture, sessionsViewProps],
  );
  return (
    <Stack
      direction="row"
      data-demo-scene="agent-sessions-tab"
      sx={{ width: SCENE_WIDTH, height: SCENE_HEIGHT }}
    >
      <RealSidebar {...sidebarProps} />
      <Box
        data-testid="first-agent-session-step-demo-agent-sessions-tab"
        sx={{ flex: 1, minWidth: 0, pointerEvents: "none", overflow: "hidden" }}
      >
        <TaskPageView {...sceneFixture} />
      </Box>
    </Stack>
  );
};
AgentSessionsScene.displayName = "AgentSessionsScene";

interface BuildScenesArgs {
  organizationId: string;
  projectId: string;
}

const buildScenes = ({
  organizationId,
  projectId,
}: BuildScenesArgs): MiniDemoScene[] => [
  {
    id: "task-tab",
    targetId: MINI_DEMO_TARGETS.codingSessionsTab,
    content: (
      <TaskTabScene organizationId={organizationId} projectId={projectId} />
    ),
    durationMs: 2800,
    cursor: [
      { t: 0, x: 640, y: 540 },
      { t: 1800, target: MINI_DEMO_TARGETS.codingSessionsTab },
      {
        t: 2200,
        target: MINI_DEMO_TARGETS.codingSessionsTab,
        click: true,
      },
      { t: 2800, target: MINI_DEMO_TARGETS.codingSessionsTab },
    ],
  },
  {
    id: "agent-sessions-tab",
    targetId: MINI_DEMO_TARGETS.startNewSessionButton,
    content: (
      <AgentSessionsScene
        organizationId={organizationId}
        projectId={projectId}
      />
    ),
    durationMs: 3200,
    cursor: [
      { t: 0, x: 640, y: 540 },
      { t: 1800, target: MINI_DEMO_TARGETS.startNewSessionButton },
      {
        t: 2200,
        target: MINI_DEMO_TARGETS.startNewSessionButton,
        click: true,
      },
      { t: 3200, target: MINI_DEMO_TARGETS.startNewSessionButton },
    ],
  },
];

export const FirstAgentSessionStepDemo: React.FC<
  FirstAgentSessionStepDemoProps
> = ({ organizationId, projectId }) => {
  const scenes = useMemo(
    () =>
      buildScenes({
        organizationId,
        projectId,
      }),
    [organizationId, projectId],
  );

  return (
    <MiniDemoPlayer
      scenes={scenes}
      caption="Open the Agent Sessions tab and click Start New Session — that's where the agent picks up the work."
      loop
    />
  );
};
