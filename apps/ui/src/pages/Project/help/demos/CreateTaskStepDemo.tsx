import React, { useMemo } from "react";
import { Box, Stack } from "@mui/material";

import { EntityType, type TaskResponseDto } from "@hey-hey/ui-common/api";
import {
  DiscussModal,
  MINI_DEMO_TARGETS,
  MiniDemoPlayer,
} from "@hey-hey/ui-common/components";
import type { MiniDemoScene } from "@hey-hey/ui-common/components";
import { useFeatures } from "@hey-hey/ui-common/data";

import { ExplorerSidebar } from "../../../../components/Explorer/ExplorerSidebar";
import { FeaturePageView } from "../../../Features/FeaturePageView";
import {
  SYNTHETIC_CHILD_TASKS,
  buildFeaturePageFixture,
} from "./featurePageFixture";

const SCENE_WIDTH = 1280;
const SCENE_HEIGHT = 720;
const SIDEBAR_WIDTH = 260;

const EXAMPLE_PROMPT =
  "Add a settings page where the user can change their notification preferences";

interface CreateTaskStepDemoProps {
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

interface TaskTabSceneProps extends RealSidebarProps {
  featurePageFeature?: TaskResponseDto;
}

const TaskTabScene: React.FC<TaskTabSceneProps> = ({
  featurePageFeature,
  ...sidebarProps
}) => {
  const fixture = useMemo(
    () =>
      buildFeaturePageFixture(featurePageFeature, {
        activeTab: "children:STANDARD",
        children: [...SYNTHETIC_CHILD_TASKS],
      }),
    [featurePageFeature],
  );
  return (
    <Stack
      direction="row"
      data-demo-scene="task-tab"
      sx={{ width: SCENE_WIDTH, height: SCENE_HEIGHT }}
    >
      <RealSidebar {...sidebarProps} />
      <Box
        data-testid="create-task-step-demo-task-tab"
        sx={{ flex: 1, minWidth: 0, pointerEvents: "none", overflow: "hidden" }}
      >
        <FeaturePageView {...fixture} />
      </Box>
    </Stack>
  );
};
TaskTabScene.displayName = "TaskTabScene";

interface DiscussModalSceneProps extends RealSidebarProps {
  featurePageFeature?: TaskResponseDto;
}

const noopVoid = (): void => {
  /* demo no-op */
};

const DiscussModalScene: React.FC<DiscussModalSceneProps> = ({
  featurePageFeature,
  ...sidebarProps
}) => {
  const fixture = useMemo(
    () =>
      buildFeaturePageFixture(featurePageFeature, {
        activeTab: "children:STANDARD",
        children: [...SYNTHETIC_CHILD_TASKS],
      }),
    [featurePageFeature],
  );
  return (
    <Stack
      direction="row"
      data-demo-scene="discuss-modal"
      sx={{
        width: SCENE_WIDTH,
        height: SCENE_HEIGHT,
        position: "relative",
        pointerEvents: "none",
      }}
    >
      <RealSidebar {...sidebarProps} />
      <Box
        data-testid="create-task-step-demo-discuss-modal"
        sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}
      >
        <FeaturePageView {...fixture} />
      </Box>
      <DiscussModal
        open
        onClose={noopVoid}
        onSubmit={async () => false}
        walkthroughEntity={null}
        entityTitle={fixture.task.name}
        organizationId={fixture.organizationId}
        projectId={fixture.projectId}
        focalEntity={{
          kind: "entity",
          entityType: EntityType.Task,
          entityId: fixture.task.id,
        }}
        fileReferenceScope={{
          kind: "feature",
          featureId: fixture.task.id,
        }}
        submitError={null}
        onClearSubmitError={noopVoid}
        initialValue={EXAMPLE_PROMPT}
        disablePortal
      />
    </Stack>
  );
};

interface BuildScenesArgs {
  organizationId: string;
  projectId: string;
  featurePageFeature?: TaskResponseDto;
}

const buildScenes = ({
  organizationId,
  projectId,
  featurePageFeature,
}: BuildScenesArgs): MiniDemoScene[] => [
  {
    id: "task-tab",
    targetId: MINI_DEMO_TARGETS.featureChildrenDiscussButton,
    content: (
      <TaskTabScene
        organizationId={organizationId}
        projectId={projectId}
        featurePageFeature={featurePageFeature}
      />
    ),
    durationMs: 2800,
    cursor: [
      { t: 0, x: 640, y: 540 },
      { t: 1800, target: MINI_DEMO_TARGETS.featureChildrenDiscussButton },
      {
        t: 2200,
        target: MINI_DEMO_TARGETS.featureChildrenDiscussButton,
        click: true,
      },
      { t: 2800, target: MINI_DEMO_TARGETS.featureChildrenDiscussButton },
    ],
  },
  {
    id: "discuss-modal",
    content: (
      <DiscussModalScene
        organizationId={organizationId}
        projectId={projectId}
        featurePageFeature={featurePageFeature}
      />
    ),
    durationMs: 3200,
  },
];

export const CreateTaskStepDemo: React.FC<CreateTaskStepDemoProps> = ({
  organizationId,
  projectId,
}) => {
  const { features } = useFeatures(organizationId, projectId);
  const featurePageFeature = features[0];

  const scenes = useMemo(
    () =>
      buildScenes({
        organizationId,
        projectId,
        featurePageFeature,
      }),
    [organizationId, projectId, featurePageFeature],
  );
  return (
    <MiniDemoPlayer
      scenes={scenes}
      caption="Click Discuss Tasks on a feature, describe the work in plain English, and the agent drafts the tasks for you."
      loop
    />
  );
};
