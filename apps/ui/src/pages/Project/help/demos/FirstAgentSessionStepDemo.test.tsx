import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@hey-hey/ui-common/data", () => ({
  useDesignDocs: () => ({ designDocs: [], isLoading: false }),
  useFeatures: () => ({ features: [], isLoading: false, error: null }),
  useService: () => ({ data: null }),
  useTaskHierarchy: () => ({ hierarchy: undefined, isLoading: false }),
}));

interface CapturedScene {
  id: string;
  content: React.ReactNode;
  targetId?: string;
  cursor?:
    | { t: number; x: number; y: number; click?: boolean }[]
    | { t: number; target: string; click?: boolean }[];
}

const capturedScenesRef: { current: CapturedScene[] } = { current: [] };

vi.mock("@hey-hey/ui-common/components", () => ({
  MINI_DEMO_TARGETS: {
    featuresNavLink: "features-nav-link",
    servicesNavLink: "services-nav-link",
    featureChildrenDiscussButton: "feature-children-discuss-button",
    createServiceButton: "create-service-button",
    codingSessionsTab: "coding-sessions-tab",
    startNewSessionButton: "start-new-session-button",
    createServiceSubmitButton: "create-service-submit-button",
  },
  MiniDemoPlayer: ({
    scenes,
    caption,
  }: {
    scenes: CapturedScene[];
    caption?: string;
  }) => {
    capturedScenesRef.current = scenes;
    return (
      <div data-testid="mini-demo-player">
        {caption && <div data-testid="mini-demo-caption">{caption}</div>}
        {scenes.map((scene) => (
          <div key={scene.id} data-testid={`mini-demo-scene-${scene.id}`}>
            {scene.content}
          </div>
        ))}
      </div>
    );
  },
}));

const taskPageViewSpy = vi.fn();
vi.mock("../../../Task/TaskPageView", () => ({
  TaskPageView: (props: unknown) => {
    taskPageViewSpy(props);
    const { activeTab, agentSessionsTabBody } = props as {
      activeTab?: string;
      agentSessionsTabBody?: React.ReactNode;
    };
    return (
      <div data-testid="task-page-view-rendered">
        {activeTab === "task" && (
          <button
            aria-label="Agent Sessions"
            data-demo-target="coding-sessions-tab"
            data-tab-value="agent-sessions"
            role="tab"
            type="button"
          >
            Agent Sessions
          </button>
        )}
        {agentSessionsTabBody}
      </div>
    );
  },
}));

const taskScopedAgentSessionsTabViewSpy = vi.fn();
vi.mock("../../../../components/Tabs/TaskScopedAgentSessionsTabView", () => ({
  TaskScopedAgentSessionsTabView: (props: unknown) => {
    taskScopedAgentSessionsTabViewSpy(props);
    return (
      <div data-testid="task-scoped-agent-sessions-tab-view-rendered">
        <button data-demo-target="start-new-session-button" type="button">
          Start New Session
        </button>
      </div>
    );
  },
}));

vi.mock("../../../../components/Explorer/ExplorerSidebar", () => ({
  ExplorerSidebar: (props: { organizationId: string; projectId: string }) => (
    <div
      data-testid="explorer-sidebar-rendered"
      data-org={props.organizationId}
      data-project={props.projectId}
    />
  ),
}));

import { FirstAgentSessionStepDemo } from "./FirstAgentSessionStepDemo";

afterEach(() => {
  capturedScenesRef.current = [];
  taskPageViewSpy.mockClear();
  taskScopedAgentSessionsTabViewSpy.mockClear();
});

describe("FirstAgentSessionStepDemo", () => {
  it("renders MiniDemoPlayer with two scenes wrapped in pointer-events:none", () => {
    render(
      <MemoryRouter>
        <FirstAgentSessionStepDemo
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("mini-demo-player")).toBeInTheDocument();
    const taskTabWrapper = screen.getByTestId(
      "first-agent-session-step-demo-task-tab",
    );
    expect(taskTabWrapper).toHaveStyle({ pointerEvents: "none" });
    const agentSessionsWrapper = screen.getByTestId(
      "first-agent-session-step-demo-agent-sessions-tab",
    );
    expect(agentSessionsWrapper).toHaveStyle({ pointerEvents: "none" });
  });

  it("captures the two scene ids in order: task tab then agent-sessions tab", () => {
    render(
      <MemoryRouter>
        <FirstAgentSessionStepDemo
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(capturedScenesRef.current.map((scene) => scene.id)).toEqual([
      "task-tab",
      "agent-sessions-tab",
    ]);
  });

  it("renders the agent-sessions scene with TaskScopedAgentSessionsTabView and an empty session list", () => {
    render(
      <MemoryRouter>
        <FirstAgentSessionStepDemo
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(taskPageViewSpy).toHaveBeenCalledTimes(2);
    const sceneOneProps = taskPageViewSpy.mock.calls[0]?.[0] as {
      activeTab: string;
      agentSessionsTabBody?: React.ReactNode;
    };
    expect(sceneOneProps.activeTab).toBe("task");
    expect(sceneOneProps.agentSessionsTabBody).toBeUndefined();

    const sceneTwoProps = taskPageViewSpy.mock.calls[1]?.[0] as {
      activeTab: string;
      agentSessionsTabBody?: React.ReactNode;
    };
    expect(sceneTwoProps.activeTab).toBe("agent-sessions");
    expect(sceneTwoProps.agentSessionsTabBody).toBeDefined();

    expect(taskScopedAgentSessionsTabViewSpy).toHaveBeenCalledTimes(1);
    const tabViewProps = taskScopedAgentSessionsTabViewSpy.mock
      .calls[0]?.[0] as {
      sessions: unknown[];
    };
    expect(tabViewProps.sessions).toEqual([]);
    expect(
      screen.getByTestId("task-scoped-agent-sessions-tab-view-rendered"),
    ).toBeInTheDocument();
  });

  it("emits cursor timelines that end in a click on each scene", () => {
    render(
      <MemoryRouter>
        <FirstAgentSessionStepDemo
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    for (const scene of capturedScenesRef.current) {
      const cursor = scene.cursor ?? [];
      expect(cursor.length).toBeGreaterThan(0);
      expect(cursor.some((frame) => frame.click === true)).toBe(true);
    }
  });

  it("marks the Agent Sessions and Start New Session controls used by playback", () => {
    render(
      <MemoryRouter>
        <FirstAgentSessionStepDemo
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    const expectedTargets = [
      ["task-tab", "coding-sessions-tab"],
      ["agent-sessions-tab", "start-new-session-button"],
    ] as const;
    for (const [sceneId, targetId] of expectedTargets) {
      const scene = capturedScenesRef.current.find(
        (candidate) => candidate.id === sceneId,
      );
      expect(scene?.targetId).toBe(targetId);
      expect(
        screen
          .getByTestId(`mini-demo-scene-${sceneId}`)
          .querySelectorAll(`[data-demo-scene="${sceneId}"]`),
      ).toHaveLength(1);
      expect(
        screen
          .getByTestId(`mini-demo-scene-${sceneId}`)
          .querySelectorAll(`[data-demo-target="${targetId}"]`),
      ).toHaveLength(1);
    }
  });
});
