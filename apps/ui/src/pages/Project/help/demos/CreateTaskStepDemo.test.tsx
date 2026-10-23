import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const useFeaturesSpy = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useDesignDocs: () => ({ designDocs: [], isLoading: false }),
  useFeatures: (...args: unknown[]) => {
    useFeaturesSpy(...args);
    return { features: [], isLoading: false, error: null };
  },
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

const discussModalSpy = vi.fn();

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
  DiscussModal: (props: unknown) => {
    discussModalSpy(props);
    return <div data-testid="discuss-modal-rendered" />;
  },
}));

const featurePageViewSpy = vi.fn();
vi.mock("../../../Features/FeaturePageView", () => ({
  FeaturePageView: (props: unknown) => {
    featurePageViewSpy(props);
    return (
      <div data-testid="feature-page-view-rendered">
        <button
          data-demo-target="feature-children-discuss-button"
          data-testid="feature-children-discuss-button"
          type="button"
        >
          Discuss Tasks
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

import { CreateTaskStepDemo } from "./CreateTaskStepDemo";

afterEach(() => {
  vi.useRealTimers();
  capturedScenesRef.current = [];
  featurePageViewSpy.mockClear();
  discussModalSpy.mockClear();
  useFeaturesSpy.mockClear();
});

describe("CreateTaskStepDemo", () => {
  it("renders MiniDemoPlayer with two scenes wrapped in pointer-events:none", () => {
    render(
      <MemoryRouter>
        <CreateTaskStepDemo organizationId="org-1" projectId="project-1" />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("mini-demo-player")).toBeInTheDocument();
    const taskTabWrapper = screen.getByTestId("create-task-step-demo-task-tab");
    expect(taskTabWrapper).toHaveStyle({ pointerEvents: "none" });
    const discussModalWrapper = screen.getByTestId(
      "create-task-step-demo-discuss-modal",
    );
    expect(discussModalWrapper.parentElement).toHaveStyle({
      pointerEvents: "none",
    });
  });

  it("renders both scenes with FeaturePageView using activeTab='children:STANDARD'", () => {
    render(
      <MemoryRouter>
        <CreateTaskStepDemo organizationId="org-1" projectId="project-1" />
      </MemoryRouter>,
    );

    expect(featurePageViewSpy).toHaveBeenCalledTimes(2);
    const sceneOneProps = featurePageViewSpy.mock.calls[0]?.[0] as {
      activeTab: string;
      children: unknown[];
      isDiscussTasksOpen: boolean;
    };
    expect(sceneOneProps.activeTab).toBe("children:STANDARD");
    expect(sceneOneProps.children.length).toBeGreaterThan(0);
    expect(sceneOneProps.isDiscussTasksOpen).toBe(false);
  });

  it("renders DiscussModal inline (disablePortal) in scene 2 with the example prompt as initialValue", () => {
    render(
      <MemoryRouter>
        <CreateTaskStepDemo organizationId="org-1" projectId="project-1" />
      </MemoryRouter>,
    );

    expect(featurePageViewSpy).toHaveBeenCalledTimes(2);
    const sceneTwoProps = featurePageViewSpy.mock.calls[1]?.[0] as {
      activeTab: string;
      isDiscussTasksOpen: boolean;
    };
    expect(sceneTwoProps.activeTab).toBe("children:STANDARD");
    // Scene 2's modal is rendered as a sibling overlay with disablePortal —
    // FeaturePageView itself stays in its non-modal state so the production
    // Dialog never portals out to document.body.
    expect(sceneTwoProps.isDiscussTasksOpen).toBe(false);

    expect(discussModalSpy).toHaveBeenCalledTimes(1);
    const modalProps = discussModalSpy.mock.calls[0]?.[0] as {
      open: boolean;
      disablePortal: boolean;
      initialValue: string;
    };
    expect(modalProps.open).toBe(true);
    expect(modalProps.disablePortal).toBe(true);
    expect(modalProps.initialValue).toBe(
      "Add a settings page where the user can change their notification preferences",
    );
  });

  it("calls useFeatures with the demo's organization and project ids", () => {
    render(
      <MemoryRouter>
        <CreateTaskStepDemo organizationId="org-1" projectId="project-1" />
      </MemoryRouter>,
    );

    expect(useFeaturesSpy).toHaveBeenCalledWith("org-1", "project-1");
  });

  it("falls back to the synthetic Authentication feature when useFeatures returns no features", () => {
    render(
      <MemoryRouter>
        <CreateTaskStepDemo organizationId="org-1" projectId="project-1" />
      </MemoryRouter>,
    );

    expect(featurePageViewSpy).toHaveBeenCalledTimes(2);
    for (const call of featurePageViewSpy.mock.calls) {
      const props = call[0] as { task: { id: string; name: string } };
      expect(props.task.id).toBe("demo-feature-1");
      expect(props.task.name).toBe("Authentication");
    }
  });

  it("captures both scene ids and a cursor timeline that ends in a click on scene 1", () => {
    render(
      <MemoryRouter>
        <CreateTaskStepDemo organizationId="org-1" projectId="project-1" />
      </MemoryRouter>,
    );

    expect(capturedScenesRef.current.map((scene) => scene.id)).toEqual([
      "task-tab",
      "discuss-modal",
    ]);
    const taskTabScene = capturedScenesRef.current.find(
      (scene) => scene.id === "task-tab",
    );
    const cursor = taskTabScene?.cursor ?? [];
    expect(cursor.length).toBeGreaterThan(0);
    expect(cursor.some((frame) => frame.click === true)).toBe(true);
  });

  it("uses the production Discuss Tasks marker for the measured click target", () => {
    render(
      <MemoryRouter>
        <CreateTaskStepDemo organizationId="org-1" projectId="project-1" />
      </MemoryRouter>,
    );

    const scene = capturedScenesRef.current.find(
      (candidate) => candidate.id === "task-tab",
    );
    expect(scene?.targetId).toBe("feature-children-discuss-button");
    expect(
      scene?.cursor?.some(
        (frame) =>
          "target" in frame &&
          frame.target === "feature-children-discuss-button" &&
          frame.click === true,
      ),
    ).toBe(true);

    const sceneElement = screen.getByTestId("mini-demo-scene-task-tab");
    expect(
      sceneElement.querySelectorAll('[data-demo-scene="task-tab"]'),
    ).toHaveLength(1);
    expect(
      sceneElement.querySelectorAll(
        '[data-demo-target="feature-children-discuss-button"]',
      ),
    ).toHaveLength(1);
    expect(
      sceneElement.querySelector(
        '[data-demo-target="feature-children-discuss-button"]',
      ),
    ).toHaveTextContent("Discuss Tasks");
  });
});
