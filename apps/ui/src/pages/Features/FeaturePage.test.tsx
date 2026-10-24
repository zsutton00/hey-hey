import {
  WorkItemTypeRole,
  WorkStatus,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FeaturePage } from "./FeaturePage";

const {
  mockChildTabsLogInfo,
  mockChildTabsLogWarn,
  mockCreateTask,
  mockUpdateTask,
} = vi.hoisted(() => ({
  mockChildTabsLogInfo: vi.fn(),
  mockChildTabsLogWarn: vi.fn(),
  mockCreateTask: vi.fn(),
  mockUpdateTask: vi.fn(),
}));
const mockFeaturePageView = vi.fn();
const mockSetActiveTab = vi.fn();
const mockSetActiveType = vi.fn();
const mockUseWorkItems = vi.fn();
let mockActiveTab = "feature";
let mockTaskSort = "createdAt:desc";
let mockAllowedChildTypes: readonly string[] | undefined = [];
let mockWorkItemTypesFetched = true;

const featureTask = {
  id: "feature-1",
  name: "Feature",
  type: "FEATURE",
  projectId: "project-1",
  organizationId: "org-1",
  status: WorkStatus.Backlog,
  sections: [],
  childCounts: { total: 0 },
} as TaskResponseDto;

const featureHierarchy = [
  {
    id: "ancestor-1",
    name: "Ancestor feature",
    relationshipType: "structural",
    relationship: "ancestor",
    distance: 1,
  },
];

const parentDefinition: WorkItemTypeDefinitionDto = {
  key: "FEATURE",
  name: "Feature",
  sections: [{ key: "description", label: "Description" }],
  allowedStatuses: [],
  allowedParentTypes: [],
};

const createDefinition = (
  key: string,
  name: string,
  allowedParentTypes: string[] = ["FEATURE"],
  allowedStatuses: WorkItemTypeDefinitionDto["allowedStatuses"] = [
    WorkStatus.Backlog,
  ],
): WorkItemTypeDefinitionDto => ({
  key,
  name,
  sections: [{ key: "description", label: "Description" }],
  allowedStatuses,
  allowedParentTypes,
});

const childDefinitions = [
  createDefinition("BUG", "Bug"),
  createDefinition("CONTRACT", "Contract", ["FEATURE"], [WorkStatus.Active]),
  createDefinition("FEATURE", "Feature"),
  createDefinition("STANDARD", "Task"),
  createDefinition("TASK_MONITOR", "Task Monitor"),
  createDefinition("workflow", "Workflow"),
];

const workItemTypes = [
  ...childDefinitions.map((definition) => ({
    definition,
    projectId: "project-1",
    status: "ACTIVE" as const,
  })),
  {
    definition: createDefinition("ARCHIVED", "Archived Child"),
    projectId: "project-1",
    status: "ARCHIVED" as const,
  },
  {
    definition: createDefinition("OTHER_PROJECT", "Other Project Child"),
    projectId: "project-2",
    status: "ACTIVE" as const,
  },
];
let mockWorkItemTypes = workItemTypes;

vi.mock("nuqs", () => ({
  parseAsInteger: { withDefault: (value: number) => value },
  parseAsString: { withDefault: (value: string) => value },
  parseAsStringLiteral: () => ({ withDefault: (value: string) => value }),
  useQueryState: (key: string) =>
    key === "tab"
      ? [mockActiveTab, mockSetActiveTab]
      : [
          key.endsWith("Page") ? 1 : key.endsWith("Sort") ? mockTaskSort : "",
          key === "type" ? mockSetActiveType : vi.fn(),
        ],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  useEntityConversationLauncher: () => ({
    isLoading: false,
    error: null,
    clearError: vi.fn(),
    launch: vi.fn(),
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("@hey-hey/ui-common/utils", () => ({
  taskContentToSectionInputs: (
    content: Record<string, string>,
    { selection }: { selection: { sections: Array<{ key: string }> } },
  ) =>
    selection.sections.flatMap((section, order) =>
      content[section.key]?.trim()
        ? [{ key: section.key, content: content[section.key], order }]
        : [],
    ),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
  // Cached hierarchy unavailable, so pages use the server-derived ancestry.
  useFeatureLookup: () => ({
    isReady: false,
    isLoading: false,
    get: () => undefined,
    resolveAncestry: () => ({ ancestors: [], complete: false }),
  }),
  useProject: () => ({ data: { id: "project-1", name: "Project" } }),
  useFullEntityContext: () => ({ data: { featureHierarchy } }),
  useProjectPlans: () => ({ plans: [], isLoading: false }),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: parentDefinition,
    isFetched: true,
  }),
  useAllowedChildWorkItemTypes: () => ({
    workItemTypes: mockWorkItemTypes,
    allowedChildTypes: mockAllowedChildTypes,
    isFetched: mockWorkItemTypesFetched,
    isReady: mockWorkItemTypesFetched,
    error: null,
  }),
  useWorkItems: (...args: unknown[]) => {
    mockUseWorkItems(...args);
    const options = args[4] as { enabled?: boolean } | undefined;
    return {
      createTask: mockCreateTask,
      remove: vi.fn(),
      workItems: [],
      isLoading: false,
      isFetched: options?.enabled === true,
    };
  },
  useWorkItemUpdateMethods: () => ({ updateTask: mockUpdateTask }),
}));

vi.mock("../../utils/statusUtils", () => ({ isTaskRefining: () => false }));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: mockChildTabsLogInfo,
    warn: mockChildTabsLogWarn,
  },
}));

vi.mock("./FeaturePageView", () => ({
  FeaturePageView: (props: {
    allowedChildTypes: string[];
    isChildrenLoading: boolean;
    taskId: string;
    onDone?: (taskId: string) => void;
    onTabChange?: (value: string) => void;
  }) => {
    mockFeaturePageView(props);
    return (
      <div
        data-testid="feature-page-view"
        data-child-types={props.allowedChildTypes.join(",")}
        data-children-loading={String(props.isChildrenLoading)}
      >
        <button
          type="button"
          data-testid="feature-editor-done"
          onClick={() => props.onDone?.(props.taskId)}
        >
          Done
        </button>
        <button
          type="button"
          data-testid="feature-work-items-tab"
          onClick={() => props.onTabChange?.(WorkItemTypeRole.WorkItem)}
        >
          Work Items
        </button>
      </div>
    );
  },
}));

const renderFeaturePage = (
  initialEntry = "/projects/project-1/features/feature-1",
) =>
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/projects/:projectId/features/:taskId"
          element={<FeaturePage task={featureTask} />}
        />
      </Routes>
    </MemoryRouter>,
  );

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
};

describe("FeaturePage registry-derived children", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = "children:BUG";
    mockTaskSort = "createdAt:desc";
    mockAllowedChildTypes = [
      "BUG",
      "CONTRACT",
      "FEATURE",
      "STANDARD",
      "TASK_MONITOR",
      "workflow",
    ];
    mockWorkItemTypesFetched = true;
    mockWorkItemTypes = workItemTypes;
  });

  it("returns clean feature editing to the same route and removes only editing", async () => {
    mockActiveTab = "feature";
    renderFeaturePage(
      "/projects/project-1/features/feature-1?editing=true&tab=feature&planId=plan-1",
    );

    await waitFor(() => {
      expect(screen.getByTestId("feature-editor-done")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("feature-editor-done"));

    expect(mockFeaturePageView).toHaveBeenLastCalledWith(
      expect.objectContaining({ isEditing: false }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/features/feature-1?tab=feature&planId=plan-1",
    );
  });

  it("uses the exact inverse relationship result for tabs and the selected query", async () => {
    renderFeaturePage();

    await waitFor(() =>
      expect(screen.getByTestId("feature-page-view")).toHaveAttribute(
        "data-child-types",
        "BUG,CONTRACT,FEATURE,STANDARD,TASK_MONITOR,workflow",
      ),
    );
    expect(screen.getByTestId("feature-page-view")).toHaveAttribute(
      "data-children-loading",
      "false",
    );
    expect(mockFeaturePageView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task: featureTask,
        featureAncestors: [{ id: "ancestor-1", name: "Ancestor feature" }],
      }),
    );
    const childQueryCall = mockUseWorkItems.mock.calls.find((args) => {
      const options = args[4] as { taskType?: string } | undefined;
      return options?.taskType === "BUG";
    });
    expect(childQueryCall?.[4]).toEqual(
      expect.objectContaining({ enabled: true }),
    );
    expect(childQueryCall?.[4]).not.toEqual(
      expect.objectContaining({ sortBy: expect.anything() }),
    );
    expect(mockSetActiveTab).not.toHaveBeenCalledWith("feature");
    expect(mockChildTabsLogInfo).toHaveBeenCalledWith(
      "ui",
      expect.stringContaining(
        '[child tabs] FeaturePage state\n{\n  "page": "feature"',
      ),
    );
    expect(mockChildTabsLogInfo).toHaveBeenCalledWith(
      "ui",
      expect.stringContaining('"routeDecision": "accepted"'),
    );
    expect(mockChildTabsLogInfo).toHaveBeenCalledWith(
      "ui",
      expect.stringContaining('"childQueryEnabled": true'),
    );
  });

  it("defaults a selected Work Items role tab to Standard", async () => {
    mockActiveTab = WorkItemTypeRole.WorkItem;
    mockAllowedChildTypes = ["BUG", "STANDARD"];
    mockWorkItemTypes = [
      {
        definition: {
          ...createDefinition("BUG", "Bug"),
          role: WorkItemTypeRole.WorkItem,
        },
        projectId: "project-1",
        status: "ACTIVE" as const,
      },
      {
        definition: {
          ...createDefinition("STANDARD", "Task"),
          role: WorkItemTypeRole.WorkItem,
        },
        projectId: "project-1",
        status: "ACTIVE" as const,
      },
    ];

    renderFeaturePage();

    await waitFor(() =>
      expect(screen.getByTestId("feature-work-items-tab")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId("feature-work-items-tab"));

    expect(
      mockSetActiveTab.mock.calls.some(
        ([value]) => value === WorkItemTypeRole.WorkItem,
      ),
    ).toBe(true);
    expect(mockSetActiveType).toHaveBeenCalledWith("STANDARD");
  });

  it("requests feature-scoped tasks newest first when URL sort state is absent", async () => {
    mockActiveTab = "children:STANDARD";

    renderFeaturePage();

    await waitFor(() => {
      const childQueryCall = mockUseWorkItems.mock.calls.find((args) => {
        const options = args[4] as { taskType?: string } | undefined;
        return options?.taskType === "STANDARD";
      });
      expect(childQueryCall?.[4]).toEqual(
        expect.objectContaining({
          parentTaskId: "feature-1",
          page: 1,
          limit: 50,
          sortBy: "createdAt",
          sortDir: "desc",
        }),
      );
    });
  });

  it("keeps an explicit feature task sort authoritative", async () => {
    mockActiveTab = "children:STANDARD";
    mockTaskSort = "updatedAt:desc";

    renderFeaturePage();

    await waitFor(() => {
      const childQueryCall = mockUseWorkItems.mock.calls.find((args) => {
        const options = args[4] as { taskType?: string } | undefined;
        return options?.taskType === "STANDARD";
      });
      expect(childQueryCall?.[4]).toEqual(
        expect.objectContaining({
          parentTaskId: "feature-1",
          sortBy: "updatedAt",
          sortDir: "desc",
        }),
      );
      expect(mockFeaturePageView).toHaveBeenLastCalledWith(
        expect.objectContaining({
          taskListPaging: expect.objectContaining({
            sortKey: "updatedAt:desc",
          }),
        }),
      );
    });
  });

  it("preserves unavailable registry state without rejecting or querying the route", async () => {
    mockAllowedChildTypes = undefined;
    mockWorkItemTypesFetched = false;

    renderFeaturePage();

    await waitFor(() =>
      expect(screen.getByTestId("feature-page-view")).toHaveAttribute(
        "data-children-loading",
        "true",
      ),
    );
    expect(screen.getByTestId("feature-page-view")).toHaveAttribute(
      "data-child-types",
      "",
    );
    const childQueryCall = mockUseWorkItems.mock.calls.find((args) => {
      const options = args[4] as { taskType?: string } | undefined;
      return options?.taskType === "BUG";
    });
    expect(childQueryCall?.[4]).toEqual(
      expect.objectContaining({ enabled: false }),
    );
    expect(mockSetActiveTab).not.toHaveBeenCalledWith("feature");
  });

  it("rejects a stale child route without enabling its scoped query", async () => {
    mockActiveTab = "children:ARCHIVED";

    renderFeaturePage();

    await waitFor(() =>
      expect(mockSetActiveTab).toHaveBeenCalledWith("feature"),
    );
    expect(mockChildTabsLogWarn).toHaveBeenCalledWith(
      "ui",
      expect.stringContaining(
        "[child tabs] FeaturePage rejected child route\n{",
      ),
    );
    expect(mockChildTabsLogWarn).toHaveBeenCalledWith(
      "ui",
      expect.stringContaining('"rejectedChildType": "ARCHIVED"'),
    );
    const childQueryCall = mockUseWorkItems.mock.calls.find((args) => {
      const options = args[4] as { taskType?: string } | undefined;
      return options?.taskType === "ARCHIVED";
    });
    expect(childQueryCall?.[4]).toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("submits the registry initial status and only declared keys for a built-in child", async () => {
    mockAllowedChildTypes = ["CONTRACT"];
    mockActiveTab = "children:CONTRACT";
    renderFeaturePage();

    const props = mockFeaturePageView.mock.calls.at(-1)?.[0] as {
      onSubmitNewTask: (formData: {
        name: string;
        initiativeId: string;
        status: WorkStatus;
        sectionContent: Record<string, string>;
      }) => Promise<void>;
    };
    await act(async () => {
      await props.onSubmitNewTask({
        name: "Contract child",
        initiativeId: "",
        status: WorkStatus.RefiningDescription,
        sectionContent: {
          description: "Observed behavior",
          acceptanceCriteria: "must be discarded",
        },
      });
    });

    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CONTRACT",
        status: WorkStatus.Active,
        sections: [
          { key: "description", content: "Observed behavior", order: 0 },
        ],
      }),
    );
  });

  it("withholds child creation when the selected type has no initial status", async () => {
    const customDefinition = createDefinition(
      "MARKETING",
      "Campaign",
      ["FEATURE"],
      [],
    );
    mockAllowedChildTypes = ["MARKETING"];
    mockActiveTab = "children:MARKETING";
    mockWorkItemTypes = [
      ...workItemTypes,
      {
        definition: customDefinition,
        projectId: "project-1",
        status: "ACTIVE" as const,
      },
    ];
    renderFeaturePage();

    const props = mockFeaturePageView.mock.calls.at(-1)?.[0] as {
      onSubmitNewTask: (formData: {
        name: string;
        initiativeId: string;
        sectionContent: Record<string, string>;
      }) => Promise<void>;
    };
    await act(async () => {
      await props.onSubmitNewTask({
        name: "Campaign child",
        initiativeId: "",
        sectionContent: {},
      });
    });

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("updates the routed work item directly when its tag changes", async () => {
    renderFeaturePage();

    const props = mockFeaturePageView.mock.calls.at(-1)?.[0] as {
      onTagChanged: (tag: string) => Promise<void>;
    };
    await act(async () => {
      await props.onTagChanged("frontend");
    });

    expect(mockUpdateTask).toHaveBeenCalledWith("feature-1", {
      tag: "frontend",
    });
  });
});
