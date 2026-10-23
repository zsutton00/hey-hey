import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUseFeatureHierarchy = vi.fn();
const mockUseProject = vi.fn(() => ({ data: undefined }));
const noFeatureContent = { entries: new Map<string, unknown>() };
const mockUseFeatureDocumentContent = vi.fn(() => noFeatureContent);

vi.mock("@hey-hey/ui-common/data", () => ({
  useFeatureHierarchy: (...args: unknown[]) => mockUseFeatureHierarchy(...args),
  useFeatureDocumentContent: (...args: unknown[]) =>
    mockUseFeatureDocumentContent(...(args as [])),
  useProject: (...args: unknown[]) => mockUseProject(...args),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    feature: ({
      projectId,
      featureId,
    }: {
      projectId: string;
      featureId: string;
    }) => `/projects/${projectId}/features/${featureId}`,
  },
}));

import { useHelpDataCapability } from "./useHelpDataCapability";

describe("useHelpDataCapability", () => {
  it("maps every top-level feature to a HelpFeatureRecord with a feature href that deep-links to Discuss Tasks", () => {
    mockUseFeatureHierarchy.mockReturnValue({
      roots: [
        { feature: { id: "feat-1", name: "Authentication" }, children: [] },
        { feature: { id: "feat-2", name: "Notifications" }, children: [] },
      ],
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useHelpDataCapability("org-1", "project-1"),
    );

    expect(result.current.features).toEqual([
      {
        id: "feat-1",
        name: "Authentication",
        href: "/projects/project-1/features/feat-1?discuss=tasks",
      },
      {
        id: "feat-2",
        name: "Notifications",
        href: "/projects/project-1/features/feat-2?discuss=tasks",
      },
    ]);
  });

  it("fills each feature's overview from the first sentence of its description", () => {
    mockUseFeatureHierarchy.mockReturnValue({
      roots: [
        { feature: { id: "feat-1", name: "Authentication" }, children: [] },
        { feature: { id: "feat-2", name: "Notifications" }, children: [] },
        { feature: { id: "feat-3", name: "Billing" }, children: [] },
      ],
      isLoading: false,
      error: null,
    });
    const entry = (markdown: string) => ({
      status: "ready",
      data: {
        sections: [{ key: "description", materializedMarkdown: markdown }],
      },
    });
    mockUseFeatureDocumentContent.mockReturnValue({
      entries: new Map<string, unknown>([
        [
          "feat-1",
          entry("Lets people **sign in** safely. Supports SSO and passkeys."),
        ],
        ["feat-2", entry(`${"word ".repeat(60)}end.`)],
      ]),
    });

    const { result } = renderHook(() =>
      useHelpDataCapability("org-1", "project-1"),
    );

    const [auth, notifications, billing] = result.current.features;
    expect(auth.overview).toBe("Lets people sign in safely.");
    expect(notifications.overview?.length).toBeLessThanOrEqual(160);
    expect(notifications.overview?.endsWith("…")).toBe(true);
    expect(billing.overview).toBeUndefined();
    mockUseFeatureDocumentContent.mockReturnValue(noFeatureContent);
  });

  it("returns an empty list when the project has no features", () => {
    mockUseFeatureHierarchy.mockReturnValue({
      roots: [],
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useHelpDataCapability("org-1", "project-1"),
    );

    expect(result.current.features).toEqual([]);
  });

  it("forwards organizationId and projectId to useFeatureHierarchy", () => {
    mockUseFeatureHierarchy.mockClear();
    mockUseFeatureHierarchy.mockReturnValue({
      roots: [],
      isLoading: false,
      error: null,
    });

    renderHook(() => useHelpDataCapability("org-7", "project-9"));

    expect(mockUseFeatureHierarchy).toHaveBeenCalledWith("org-7", "project-9");
  });

  it("joins saved next-step suggestions and their starter prompts to live top-level features and drops missing ones", () => {
    mockUseFeatureHierarchy.mockReturnValue({
      roots: [
        { feature: { id: "feat-1", name: "Recipe Library" }, children: [] },
        { feature: { id: "feat-2", name: "Meal Planner" }, children: [] },
      ],
      isLoading: false,
      error: null,
    });
    mockUseProject.mockReturnValue({
      data: {
        config: {
          version: 1,
          existingWorkIntent: "declined",
          featureNextSteps: [
            {
              featureId: "feat-2",
              kind: "MOCKUPS",
              rationale: "Sketch it.",
              starterPrompt: "Flesh out Meal Planner, then mock up its board.",
            },
            {
              featureId: "gone",
              kind: "TASKS",
              rationale: "Deleted.",
              starterPrompt: "Flesh out a deleted Feature.",
            },
          ],
        },
      },
    } as never);

    const { result } = renderHook(() =>
      useHelpDataCapability("org-1", "project-1"),
    );

    expect(result.current.featureNextSteps).toEqual([
      {
        feature: {
          id: "feat-2",
          name: "Meal Planner",
          href: "/projects/project-1/features/feat-2?discuss=tasks",
        },
        kind: "MOCKUPS",
        rationale: "Sketch it.",
        starterPrompt: "Flesh out Meal Planner, then mock up its board.",
      },
    ]);
  });

  it("supplies no suggestions when the project config has none", () => {
    mockUseFeatureHierarchy.mockReturnValue({
      roots: [
        { feature: { id: "feat-1", name: "Recipe Library" }, children: [] },
      ],
      isLoading: false,
      error: null,
    });
    mockUseProject.mockReturnValue({
      data: { config: { version: 1, existingWorkIntent: "unanswered" } },
    } as never);

    const { result } = renderHook(() =>
      useHelpDataCapability("org-1", "project-1"),
    );

    expect(result.current.featureNextSteps).toEqual([]);
  });
});
