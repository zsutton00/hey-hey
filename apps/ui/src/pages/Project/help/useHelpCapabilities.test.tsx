import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUseFeatureHierarchy = vi.fn();

const noFeatureContent = { entries: new Map() };

vi.mock("@hey-hey/ui-common/data", () => ({
  useFeatureHierarchy: (...args: unknown[]) => mockUseFeatureHierarchy(...args),
  useFeatureDocumentContent: () => noFeatureContent,
  useProject: () => ({ data: undefined }),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    project: (projectId: string) => `/projects/${projectId}`,
    feature: ({
      projectId,
      featureId,
    }: {
      projectId: string;
      featureId: string;
    }) => `/projects/${projectId}/features/${featureId}`,
  },
}));

vi.mock("@hey-hey/ui-common/components", () => {
  const HELP_DEMO_FALLBACK = Symbol("HELP_DEMO_FALLBACK");
  return {
    HELP_DEMO_FALLBACK,
  };
});

vi.mock("./demos/CreateTaskStepDemo", () => ({
  CreateTaskStepDemo: () => null,
}));

vi.mock("./demos/FirstAgentSessionStepDemo", () => ({
  FirstAgentSessionStepDemo: () => null,
}));

import { useHelpCapabilities } from "./useHelpCapabilities";

const importAction = {
  status: "ready" as const,
  error: null,
  execute: vi.fn(),
  retry: vi.fn(),
};

describe("useHelpCapabilities", () => {
  it("composes data, routing, and a total demo map covering every HelpScenarioId", () => {
    mockUseFeatureHierarchy.mockReturnValue({
      roots: [
        { feature: { id: "feat-1", name: "Authentication" }, children: [] },
      ],
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useHelpCapabilities("org-1", "project-1", importAction),
    );

    expect(result.current.data.features).toEqual([
      {
        id: "feat-1",
        name: "Authentication",
        href: "/projects/project-1/features/feat-1?discuss=tasks",
      },
    ]);

    expect(result.current.routing.buildHref("project-root")).toBe(
      "/projects/project-1",
    );

    expect(Object.keys(result.current.demos).sort()).toEqual(
      [
        "create-a-service",
        "create-a-task",
        "features-ready",
        "first-agent-session",
        "install-agent-bridge",
        "read-first-project",
      ].sort(),
    );
  });

  it("returns a stable capabilities reference across re-renders with the same inputs", () => {
    mockUseFeatureHierarchy.mockReturnValue({
      roots: [],
      isLoading: false,
      error: null,
    });

    const { result, rerender } = renderHook(
      ({ orgId, projectId }) =>
        useHelpCapabilities(orgId, projectId, importAction),
      { initialProps: { orgId: "org-1", projectId: "project-1" } },
    );

    const first = result.current;
    rerender({ orgId: "org-1", projectId: "project-1" });
    expect(result.current).toBe(first);
  });
});
