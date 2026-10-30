import { http, HttpResponse } from "msw";
import { renderWithQueryClient as render } from "../../test/renderWithQueryClient";
import { createEntityActivation } from "@hey-hey/ui-common/context";
import {
  installOpenItemsTestRuntime,
  openItemsTestUserId,
  readOpenItemsTestCache,
} from "../../test/openItemsTestRuntime";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import {
  OpenItemsProvider,
  useOpenItems,
} from "../../contexts/OpenItemsContext";
import {
  ProjectStatus,
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "@hey-hey/ui-common/api";
import {
  markDemoSandboxSession,
  useFeatureHierarchy,
  useFeatureDocumentContent,
  useAgentSession,
  useAgentSessionCurrentStates,
  useAgentSessionOutputAttentions,
  usePlan,
  useProjectPlans,
  useProjects,
  useService,
  useServices,
  useWorkItemTypes,
  useWorkItem,
  useWorkItems,
} from "@hey-hey/ui-common/data";
import {
  useAuth,
  useOrganization,
  usePreviewHost,
  useTheme,
} from "@hey-hey/ui-common/context";
import { usePermissions } from "@hey-hey/ui-common/hooks";
import { usePlatformAdminAccess } from "@hey-hey/ui-common/data";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExplorerSidebar } from "./ExplorerSidebar";
import { OpenItemsSection } from "./OpenItemsSection";

const { openPreviewMock } = vi.hoisted(() => ({
  openPreviewMock: vi.fn(),
}));
const { explorerSearchState } = vi.hoisted(() => ({
  explorerSearchState: { value: "" },
}));

vi.mock("nuqs", () => ({
  parseAsString: {
    withDefault: (value: string) => value,
  },
  useQueryState: () => React.useState(explorerSearchState.value),
}));

vi.mock("@hey-hey/ui-common/context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hey-hey/ui-common/context")>();
  return {
    ...actual,
    useCurrentCanonicalPage: () => {
      const location = useLocation();
      const match = location.pathname.match(
        /^\/projects\/[^/]+\/tasks\/([^/]+)/,
      );
      return match
        ? { entityId: match[1], entityType: "task", lineage: null }
        : null;
    },
    useAuth: vi.fn(),
    useOrganization: vi.fn(),
    usePreviewHost: vi.fn(),
    useTheme: vi.fn(),
  };
});

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useCanHover: () => true,
  usePermissions: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/data")>()),
  usePlatformAdminAccess: vi.fn(),
  useFeatureHierarchy: vi.fn(),
  useFeatureDocumentContent: vi.fn(),
  useConversation: vi.fn(() => ({
    conversation: null,
    isLoading: false,
    error: null,
  })),
  useProjectPlans: vi.fn(),
  useProjects: vi.fn(),
  useServices: vi.fn(),
  useWorkItemTypes: vi.fn(),
  useWorkItems: vi.fn(),
  useWorkItem: vi.fn(),
  useAgentSession: vi.fn(),
  useAgentSessionCurrentStates: vi.fn(),
  useAgentSessionOutputAttentions: vi.fn(),
  useConversationPhases: vi.fn(() => ({})),
  usePlan: vi.fn(),
  useService: vi.fn(),
}));

vi.mock(
  "@hey-hey/ui-common/components/InteractionComponent",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@hey-hey/ui-common/components/InteractionComponent")
      >();
    return {
      ...actual,
      useEntityDragSource: () => ({
        attributes: {},
        listeners: {},
        setNodeRef: () => undefined,
      }),
      InteractionComponent: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
      ),
      OpenItemInteractionComponent: ({
        children,
      }: {
        children: React.ReactNode;
      }) => <>{children}</>,
    };
  },
);

vi.mock("@hey-hey/ui-common/components/shared", () => ({
  EntityHoverCard: () => <div data-testid="entity-hover-card" />,
}));

vi.mock("@hey-hey/ui-common/components/Entity", () => ({
  EntityIcon: ({ entityType }: { entityType: string }) => (
    <span data-entity-type={entityType}>icon</span>
  ),
}));

vi.mock("@hey-hey/ui-common/components/Homepage", () => ({
  HeyHeyBranding: () => <div>HeyHey</div>,
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  KEYS: {
    auth: {
      login: "auth.login",
      logout: "auth.logout",
    },
    explorer: {
      error: "explorer.error",
      loading: "explorer.loading",
    },
    navigation: {
      myProjects: "navigation.myProjects",
    },
  },
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  getAuthToken: vi.fn(),
  WebPathService: {
    agentSession: ({
      projectId,
      agentSessionId,
    }: {
      projectId: string;
      agentSessionId: string;
    }) => `/projects/${projectId}/sessions/${agentSessionId}`,
    initiativeDetail: ({
      projectId,
      initiativeId,
    }: {
      projectId: string;
      initiativeId: string;
    }) => `/projects/${projectId}/initiatives/${initiativeId}`,
    task: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      `/projects/${projectId}/tasks/${taskId}`,
    conversation: ({
      projectId,
      conversationId,
    }: {
      projectId: string;
      conversationId: string;
    }) => `/projects/${projectId}/conversations/${conversationId}`,
    designDoc: ({
      projectId,
      designDocId,
    }: {
      projectId: string;
      designDocId: string;
    }) => `/projects/${projectId}/design-docs/${designDocId}`,
    plan: ({ projectId, planId }: { projectId: string; planId: string }) =>
      `/projects/${projectId}/plans/${planId}`,
    proposal: ({
      projectId,
      proposalId,
    }: {
      projectId: string;
      proposalId: string;
    }) => `/projects/${projectId}/proposals/${proposalId}`,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("./ExplorerMinimal", () => ({
  ExplorerMinimal: () => <div data-testid="explorer-minimal" />,
}));

vi.mock("./ExplorerSearch", () => ({
  ExplorerSearch: ({
    onSearchChange,
    resultCount,
    searchTerm,
  }: {
    onSearchChange: (term: string) => void;
    resultCount?: number;
    searchTerm: string;
  }) => (
    <div data-testid="explorer-search">
      <input
        aria-label="Search menu items"
        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
          onSearchChange(event.target.value)
        }
        value={searchTerm}
      />
      {resultCount !== undefined ? (
        <span data-testid="explorer-result-count">{resultCount}</span>
      ) : null}
    </div>
  ),
}));

interface ExplorerTreeMockProps {
  expandedEntityGroups: Set<string>;
  isSearching: boolean;
  nodes: unknown[];
  onToggleEntityGroup: (groupType: string) => void;
  sections: Array<{
    key: string;
    label: string;
    path?: string;
    count?: number;
    nodes: unknown[];
  }>;
}

vi.mock("./ExplorerTree", () => ({
  ExplorerTree: ({
    expandedEntityGroups,
    isSearching,
    nodes,
    onToggleEntityGroup,
    sections,
  }: ExplorerTreeMockProps) => (
    <div data-testid="explorer-tree">
      {isSearching ? (
        <div data-testid="explorer-tree-search-results">
          {nodes.map((node) => (
            <span key={(node as { id: string }).id}>
              {(node as { id: string }).id}
            </span>
          ))}
        </div>
      ) : null}
      <div data-testid="explorer-tree-section-order">
        {sections.map((section) => section.key).join(",")}
      </div>
      {sections.map((section) => {
        const sectionName = section.key.endsWith("FEATURE")
          ? "feature"
          : section.key.endsWith("GOAL")
            ? "goal"
            : section.key;
        return (
          <div
            data-testid={`explorer-tree-${sectionName}-section`}
            key={section.key}
          >
            <div data-testid={`explorer-tree-section-path-${section.key}`}>
              {section.path ?? "none"}
            </div>
            <div data-testid={`explorer-tree-section-preview-${section.key}`}>
              {section.previewCollection ?? "none"}
            </div>
            <div data-testid={`explorer-tree-section-${section.key}`}>
              {section.nodes.map((node) => (
                <span
                  data-parent-id={
                    (node as { parentId?: string }).parentId ?? ""
                  }
                  data-has-children={
                    (node as { hasChildren: boolean }).hasChildren
                  }
                  key={(node as { id: string }).id}
                >
                  {(node as { id: string }).id}
                </span>
              ))}
            </div>
            <button
              data-testid={`explorer-tree-${sectionName}-toggle`}
              onClick={() => onToggleEntityGroup(section.key)}
              type="button"
            >
              {`${section.label.toUpperCase()} (${section.count ?? section.nodes.length}) ${
                expandedEntityGroups.has(section.key) ? "expanded" : "collapsed"
              }`}
            </button>
          </div>
        );
      })}
    </div>
  ),
}));

const useAuthMock = vi.mocked(useAuth);
const useOrganizationMock = vi.mocked(useOrganization);
const usePreviewHostMock = vi.mocked(usePreviewHost);
const useThemeMock = vi.mocked(useTheme);
const usePlatformAdminAccessMock = vi.mocked(usePlatformAdminAccess);
const usePermissionsMock = vi.mocked(usePermissions);
const useProjectPlansMock = vi.mocked(useProjectPlans);
const useProjectsMock = vi.mocked(useProjects);
const useServicesMock = vi.mocked(useServices);
const useWorkItemTypesMock = vi.mocked(useWorkItemTypes);
const useWorkItemMock = vi.mocked(useWorkItem);
const useAgentSessionMock = vi.mocked(useAgentSession);
const useAgentSessionCurrentStatesMock = vi.mocked(
  useAgentSessionCurrentStates,
);
const useAgentSessionOutputAttentionsMock = vi.mocked(
  useAgentSessionOutputAttentions,
);
const usePlanMock = vi.mocked(usePlan);
const useServiceMock = vi.mocked(useService);
const useWorkItemsMock = vi.mocked(useWorkItems);

const ProjectSidebar = () => (
  <OpenItemsProvider
    organizationId="org-1"
    userId={openItemsTestUserId()}
    projectId="project-1"
  >
    <ExplorerSidebar
      isMinimal={false}
      organizationId="org-1"
      projectId="project-1"
      width={320}
    />
    <CanonicalOpenItemsReady />
  </OpenItemsProvider>
);

const OrganizationSidebar = () => (
  <ExplorerSidebar isMinimal={false} organizationId="org-1" width={320} />
);

const RouteControls = () => {
  const navigate = useNavigate();

  return (
    <div>
      <button
        onClick={() =>
          navigate(
            "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
          )
        }
        type="button"
      >
        Go task 1
      </button>
      <button
        onClick={() =>
          navigate(
            "/projects/project-1/tasks/bbc04762-4810-53b6-a5a9-7075c179551f",
          )
        }
        type="button"
      >
        Go task 2
      </button>
      <button onClick={() => navigate(-1)} type="button">
        Back
      </button>
      <button onClick={() => navigate(1)} type="button">
        Forward
      </button>
    </div>
  );
};

const RouteActivationProbe = () => {
  const location = useLocation();
  const { activate } = useOpenItems();

  React.useEffect(() => {
    const match = location.pathname.match(/^\/projects\/[^/]+\/tasks\/([^/]+)/);
    if (match) {
      activate(
        createEntityActivation("task", match[1]!, null, {
          kind: "task",
          label: "Visited task",
          taskType: "STANDARD",
        }),
      );
    }
  }, [activate, location.pathname]);

  return null;
};

function setFeatureFixtures(
  features: Array<{ id: string; name: string; parentTaskId?: string }>,
) {
  const records: TaskResponseDto[] = features.map((feature) => ({
    ...feature,
    type: "FEATURE",
    status: WorkStatus.Active,
    source: TaskSource.User,
    organizationId: "organization-1",
    projectId: "project-1",
  }));
  const nodes = new Map(
    records.map((feature) => [
      feature.id,
      {
        feature,
        children: [] as ReturnType<typeof useFeatureHierarchy>["roots"],
      },
    ]),
  );
  for (const node of nodes.values()) {
    if (node.feature.parentTaskId)
      nodes.get(node.feature.parentTaskId)?.children.push(node);
  }
  vi.mocked(useFeatureHierarchy).mockReturnValue({
    roots: [...nodes.values()].filter((node) => !node.feature.parentTaskId),
    nodes,
    isLoading: false,
    isFetching: false,
    isReady: true,
    error: null,
    resolveRoot: () => null,
  });
  vi.mocked(useFeatureDocumentContent).mockReturnValue({
    entries: new Map(
      records.map((record) => [
        record.id,
        { status: "ready" as const, data: record },
      ]),
    ),
    retry: vi.fn(),
  });
}

describe("ExplorerSidebar", () => {
  it("shows Feature-parented Plans only when the effective registry enables their section", async () => {
    const definition = {
      key: "PLAN",
      name: "Plan",
      sections: [],
      allowedStatuses: [],
      capabilities: { showsInExplorerSidebar: true },
    };
    const registry = {
      isReady: true,
      isLoading: false,
      error: null,
      workItemTypes: [
        {
          id: "plan-type",
          projectId: "project-1",
          status: "ACTIVE",
          definition,
        },
      ],
    } as unknown as ReturnType<typeof useWorkItemTypes>;
    useWorkItemTypesMock.mockReturnValue(registry);
    useWorkItemsMock.mockReturnValue({
      workItems: [
        {
          id: "46ae952c-45af-5f55-8abb-fa61aeedc28e",
          name: "Feature Plan",
          type: "PLAN",
          parentTaskId: "e8fcc19c-6e24-5444-8754-216f56ad8ca6",
        },
      ],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useWorkItems>);
    const tree = (
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectSidebar />} />
        </Routes>
      </MemoryRouter>
    );
    const view = render(tree);
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );
    expect(
      screen.getByTestId("explorer-tree-section-work-item:PLAN"),
    ).toHaveTextContent("46ae952c-45af-5f55-8abb-fa61aeedc28e");
    expect(
      screen.getByTestId("explorer-tree-section-path-work-item:PLAN"),
    ).toHaveTextContent("/projects/project-1/plans");
    const calls = useWorkItemsMock.mock.calls.filter(
      (call) => call[4]?.taskType === "PLAN" && call[4]?.enabled,
    );
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][4]?.status).toEqual(["ACTIVE", "READY", "BACKLOG"]);
    expect(calls[0][4]).not.toHaveProperty("parentTaskId");
    useWorkItemTypesMock.mockReturnValue({
      ...registry,
      workItemTypes: [
        {
          ...registry.workItemTypes[0],
          definition: {
            ...definition,
            capabilities: { showsInExplorerSidebar: false },
          },
        },
      ],
    } as ReturnType<typeof useWorkItemTypes>);
    view.rerender(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectSidebar />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.queryByTestId("explorer-tree-section-work-item:PLAN"),
    ).not.toBeInTheDocument();
    expect(useProjectPlansMock).not.toHaveBeenCalled();
  });

  it("uses cached hierarchy roots and omits nested features from the root section", async () => {
    setFeatureFixtures([
      { id: "b5494a33-aefb-537c-b1bf-1cb0fd210eaf", name: "Root feature" },
      {
        id: "62357e62-9c2e-50ae-90a2-4a6fc6a4f57e",
        name: "Nested feature",
        parentTaskId: "b5494a33-aefb-537c-b1bf-1cb0fd210eaf",
      },
    ]);
    useWorkItemTypesMock.mockReturnValue({
      isReady: true,
      isLoading: false,
      error: null,
      workItemTypes: [
        {
          id: "feature-type",
          projectId: "project-1",
          status: "ACTIVE",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: WORK_ITEM_TYPE_KEYS.Feature,
            name: "Feature",
            sections: [],
          },
        },
      ],
    } as unknown as ReturnType<typeof useWorkItemTypes>);
    useWorkItemsMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItems: [
        {
          id: "b5494a33-aefb-537c-b1bf-1cb0fd210eaf",
          name: "Root feature",
          parentTaskId: null,
          type: WORK_ITEM_TYPE_KEYS.Feature,
        },
        {
          id: "62357e62-9c2e-50ae-90a2-4a6fc6a4f57e",
          name: "Nested feature",
          parentTaskId: "b5494a33-aefb-537c-b1bf-1cb0fd210eaf",
          type: WORK_ITEM_TYPE_KEYS.Feature,
        },
      ],
    } as unknown as ReturnType<typeof useWorkItems>);

    const tree = () => (
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>
    );
    const view = render(tree());
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(
      screen.getByText("b5494a33-aefb-537c-b1bf-1cb0fd210eaf"),
    ).toHaveAttribute("data-parent-id", "");
    expect(
      screen.getByText("b5494a33-aefb-537c-b1bf-1cb0fd210eaf"),
    ).toHaveAttribute("data-has-children", "true");
    setFeatureFixtures([
      { id: "b5494a33-aefb-537c-b1bf-1cb0fd210eaf", name: "Root feature" },
    ]);
    view.rerender(tree());
    expect(
      screen.getByText("b5494a33-aefb-537c-b1bf-1cb0fd210eaf"),
    ).toHaveAttribute("data-has-children", "false");
    expect(
      screen.queryByText("62357e62-9c2e-50ae-90a2-4a6fc6a4f57e"),
    ).not.toBeInTheDocument();
    expect(
      useWorkItemsMock.mock.calls.some(
        (call) => call[4]?.taskType === WORK_ITEM_TYPE_KEYS.Feature,
      ),
    ).toBe(false);
  });
  beforeEach(() => {
    globalThis.mswServer.use(
      http.get("*/api/v1/organizations/org-1/stars", () =>
        HttpResponse.json({ success: true, data: [] }),
      ),
    );
    localStorage.clear();
    installOpenItemsTestRuntime();
    explorerSearchState.value = "";
    vi.clearAllMocks();
    setFeatureFixtures([
      { id: "e8fcc19c-6e24-5444-8754-216f56ad8ca6", name: "Explorer Sidebar" },
    ]);

    useAuthMock.mockReturnValue({
      isAuthenticated: true,
      logout: vi.fn(),
      user: {
        email: "zac@example.com",
        name: "Zac",
      },
    } as ReturnType<typeof useAuth>);

    useOrganizationMock.mockReturnValue({
      currentOrganization: {
        id: "org-1",
        name: "Org One",
      },
      organizations: [
        {
          id: "org-1",
          name: "Org One",
        },
      ],
      switchOrganization: vi.fn(),
    } as ReturnType<typeof useOrganization>);

    useThemeMock.mockReturnValue({
      mode: "light",
      toggleMode: vi.fn(),
    } as ReturnType<typeof useTheme>);

    usePreviewHostMock.mockReturnValue({
      openPreview: openPreviewMock,
    } as ReturnType<typeof usePreviewHost>);

    usePlatformAdminAccessMock.mockReturnValue({
      isPlatformAdmin: false,
      isResolved: true,
    });
    usePermissionsMock.mockReturnValue({
      accessPlayground: false,
    } as ReturnType<typeof usePermissions>);

    useProjectPlansMock.mockReturnValue({
      error: null,
      isLoading: false,
      plans: [],
    } as ReturnType<typeof useProjectPlans>);

    useProjectsMock.mockReturnValue({
      error: null,
      isFetched: true,
      isLoading: false,
      isReady: true,
      projects: [],
    } as ReturnType<typeof useProjects>);

    useServicesMock.mockReturnValue({
      error: null,
      isLoading: false,
      services: [],
    } as ReturnType<typeof useServices>);

    useWorkItemTypesMock.mockReturnValue({
      error: null,
      isFetched: true,
      isLoading: false,
      isReady: true,
      workItemTypes: [
        {
          id: "feature-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: WORK_ITEM_TYPE_KEYS.Feature,
            name: "Feature",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
        {
          id: "goal-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: WORK_ITEM_TYPE_KEYS.Goal,
            name: "Goal",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
      ],
    } as unknown as ReturnType<typeof useWorkItemTypes>);

    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: null,
    } as unknown as ReturnType<typeof useWorkItem>);

    useWorkItemMock.mockImplementation(
      (_organizationId, _entityType, entityId, options) => {
        if (!options?.enabled || !entityId) {
          return {
            error: null,
            isLoading: false,
            workItem: null,
          } as unknown as ReturnType<typeof useWorkItem>;
        }

        if (entityId === "e8a970e8-3ee8-5d4f-a62e-d273e23779ab") {
          return {
            error: null,
            isLoading: false,
            workItem: {
              id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
              name: "Task One",
            },
          } as unknown as ReturnType<typeof useWorkItem>;
        }

        if (entityId === "bbc04762-4810-53b6-a5a9-7075c179551f") {
          return {
            error: null,
            isLoading: false,
            workItem: {
              id: "bbc04762-4810-53b6-a5a9-7075c179551f",
              name: "Task Two",
            },
          } as unknown as ReturnType<typeof useWorkItem>;
        }

        return {
          error: null,
          isLoading: false,
          workItem: null,
        } as unknown as ReturnType<typeof useWorkItem>;
      },
    );

    useAgentSessionMock.mockReturnValue({
      agentSession: null,
    } as unknown as ReturnType<typeof useAgentSession>);
    useAgentSessionCurrentStatesMock.mockReturnValue({
      currentStateById: {},
      isFetching: false,
    } as unknown as ReturnType<typeof useAgentSessionCurrentStates>);
    useAgentSessionOutputAttentionsMock.mockReturnValue({});
    usePlanMock.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof usePlan>);
    useServiceMock.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useService>);

    useWorkItemsMock.mockImplementation(
      (_organizationId, _entityType, _projectId, _entityId, options) => {
        return {
          error: null,
          isLoading: false,
          workItems: [
            {
              id: "e8fcc19c-6e24-5444-8754-216f56ad8ca6",
              name: "Explorer Sidebar",
              status: "ACTIVE",
              type: WORK_ITEM_TYPE_KEYS.Feature,
            },
            {
              id: "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
              name: "North-star goal",
              status: "ACTIVE",
              type: WORK_ITEM_TYPE_KEYS.Goal,
            },
            {
              id: "4c7cfadc-db50-59db-8898-9dd451df95f7",
              name: "Completed goal",
              status: "COMPLETED",
              type: WORK_ITEM_TYPE_KEYS.Goal,
            },
            {
              id: "7d4831a3-fd0f-5930-ba77-6ba3b557abfe",
              name: "Cancelled goal",
              status: "CANCELLED",
              type: WORK_ITEM_TYPE_KEYS.Goal,
            },
            {
              id: "643c585e-cfc6-5df7-a480-9b8add9875c7",
              name: "Archived goal",
              status: "ARCHIVED",
              type: WORK_ITEM_TYPE_KEYS.Goal,
            },
          ],
        } as unknown as ReturnType<typeof useWorkItems>;
      },
    );
  });

  it("renders a Pairing entry in the user menu that navigates without a full reload", async () => {
    const SettingsPage = () => {
      const location = useLocation();
      const isPairing =
        new URLSearchParams(location.search).get("section") === "pairing";
      return (
        <div
          data-testid={isPairing ? "settings-pairing-view" : "settings-page"}
        >
          {location.pathname}
          {location.search}
        </div>
      );
    };

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
          <Route
            element={<SettingsPage />}
            path="/projects/:projectId/settings"
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    fireEvent.click(screen.getByText("Zac"));

    const pairingItem = screen.getByTestId("user-menu-pairing");
    expect(pairingItem).toHaveAttribute(
      "href",
      "/projects/project-1/settings?section=pairing",
    );

    fireEvent.click(pairingItem);

    expect(screen.getByTestId("settings-pairing-view")).toHaveTextContent(
      "/projects/project-1/settings?section=pairing",
    );
    expect(screen.queryByTestId("settings-page")).not.toBeInTheDocument();
  });

  it("uses one persistent desktop disclosure that toggles inline above the account row", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    const accountButton = screen.getByRole("button", { name: "Account menu" });
    const accountContainer = accountButton.parentElement;
    expect(accountContainer).not.toBeNull();

    expect(accountButton).toHaveAttribute("aria-expanded", "false");
    expect(accountButton).toHaveAttribute("aria-controls", "account-actions");
    expect(accountButton).toHaveStyle({ minHeight: "44px" });
    expect(screen.getByTestId("explorer-tree")).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Account actions" }),
    ).not.toBeInTheDocument();

    accountButton.focus();
    await user.keyboard("{Enter}");

    const accountActions = screen.getByRole("group", {
      name: "Account actions",
    });
    expect(accountButton).toHaveFocus();
    expect(accountButton).toHaveAttribute("aria-expanded", "true");
    expect(accountActions).toHaveAttribute("id", "account-actions");
    expect(accountActions).toHaveStyle({
      maxHeight: "min(50vh, 480px)",
      maxWidth: "100%",
      overflowX: "hidden",
      overflowY: "auto",
    });
    expect(
      accountActions.compareDocumentPosition(accountButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(accountActions).getByText("auth.logout")).toBeInTheDocument();

    await user.click(accountButton);

    await waitFor(() => {
      expect(accountButton).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByRole("group", { name: "Account actions" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("explorer-tree")).toBeInTheDocument();
    expect(accountContainer).toBeInTheDocument();
  });

  it("renders the account actions inline inside the mobile drawer", async () => {
    const onMobileNavigate = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route
            element={
              <OpenItemsProvider
                organizationId="org-1"
                userId={openItemsTestUserId()}
                projectId="project-1"
              >
                <ExplorerSidebar
                  isMinimal={false}
                  isMobileDrawer
                  onMobileNavigate={onMobileNavigate}
                  organizationId="org-1"
                  projectId="project-1"
                  width={320}
                />
                <CanonicalOpenItemsReady />
              </OpenItemsProvider>
            }
            path="/projects/:projectId"
          />
          <Route
            element={<div data-testid="settings-page">Settings page</div>}
            path="/projects/:projectId/settings"
          />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    const accountButton = screen.getByRole("button", { name: "Account menu" });
    expect(screen.getByTestId("mobile-account-container")).toHaveStyle({
      flexShrink: "1",
      overflow: "hidden",
      paddingBottom: "calc(56px + env(safe-area-inset-bottom))",
    });
    expect(screen.getByTestId("mobile-account-container").style.maxHeight).toBe(
      "",
    );
    expect(accountButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("user-menu-pairing")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    accountButton.focus();
    await user.keyboard("{Enter}");

    expect(accountButton).toHaveAttribute("aria-expanded", "true");
    const accountActions = screen.getByRole("group", {
      name: "Account actions",
    });
    expect(accountActions).toBeInTheDocument();
    expect(accountActions).toHaveAttribute("id", "account-actions");
    expect(accountActions).toHaveAttribute("tabindex", "0");
    expect(accountActions).toHaveStyle({
      maxHeight: "calc(100dvh - 56px - 60px - env(safe-area-inset-bottom))",
      maxWidth: "100%",
      overflowX: "hidden",
      overflowY: "auto",
    });
    expect(accountButton).toHaveStyle({ order: "2" });
    expect(accountButton).toBeVisible();
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
    expect(screen.getByText("auth.logout")).toBeInTheDocument();
    expect(screen.getByTestId("user-menu-pairing")).toHaveAttribute(
      "href",
      "/projects/project-1/settings?section=pairing",
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("user-menu-pairing"));

    expect(onMobileNavigate).toHaveBeenCalledOnce();
    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
  });

  it.each([
    { layout: "desktop", isMobileDrawer: false },
    { layout: "mobile", isMobileDrawer: true },
  ])(
    "shows the complete Developer Tools section to HeyHey Admins on $layout",
    async ({ isMobileDrawer }) => {
      usePlatformAdminAccessMock.mockReturnValue({
        isPlatformAdmin: true,
        isResolved: true,
      });

      render(
        <MemoryRouter initialEntries={["/projects/project-1"]}>
          <OpenItemsProvider
            organizationId="org-1"
            userId={openItemsTestUserId()}
            projectId="project-1"
          >
            <ExplorerSidebar
              isMinimal={false}
              isMobileDrawer={isMobileDrawer}
              organizationId="org-1"
              projectId="project-1"
              width={320}
            />
            <CanonicalOpenItemsReady />
          </OpenItemsProvider>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("canonical-open-items-ready"),
        ).toHaveAttribute("data-ready", "true"),
      );

      fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

      const accountActions = screen.getByRole("group", {
        name: "Account actions",
      });
      expect(
        within(accountActions).getByText("Developer Tools"),
      ).toBeInTheDocument();
      for (const entry of [
        "Internal Reports",
        "LLM Tracking",
        "Copy Access Token",
      ]) {
        expect(within(accountActions).getByText(entry)).toBeInTheDocument();
      }
      for (const removed of [
        "Search Debug Logs",
        "MCP Tool Call Logs",
        "Embeddings Admin",
        "Beta Onboarding",
        "New Work Item Type",
      ]) {
        expect(
          within(accountActions).queryByText(removed),
        ).not.toBeInTheDocument();
      }
      expect(
        within(accountActions).queryByText("Beta Access"),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    { layout: "desktop", isMobileDrawer: false, accessPlayground: false },
    { layout: "desktop", isMobileDrawer: false, accessPlayground: true },
    { layout: "mobile", isMobileDrawer: true, accessPlayground: false },
    { layout: "mobile", isMobileDrawer: true, accessPlayground: true },
  ])(
    "hides Developer Tools from non-admins on $layout with playground permission $accessPlayground",
    async ({ isMobileDrawer, accessPlayground }) => {
      usePermissionsMock.mockReturnValue({ accessPlayground } as ReturnType<
        typeof usePermissions
      >);

      render(
        <MemoryRouter initialEntries={["/projects/project-1"]}>
          <OpenItemsProvider
            organizationId="org-1"
            userId={openItemsTestUserId()}
            projectId="project-1"
          >
            <ExplorerSidebar
              isMinimal={false}
              isMobileDrawer={isMobileDrawer}
              organizationId="org-1"
              projectId="project-1"
              width={320}
            />
            <CanonicalOpenItemsReady />
          </OpenItemsProvider>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("canonical-open-items-ready"),
        ).toHaveAttribute("data-ready", "true"),
      );

      fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

      const accountActions = screen.getByRole("group", {
        name: "Account actions",
      });
      expect(
        within(accountActions).queryByText("Developer Tools"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("user-menu-admin")).not.toBeInTheDocument();
      for (const entry of [
        "Internal Reports",
        "LLM Tracking",
        "Copy Access Token",
      ]) {
        expect(
          within(accountActions).queryByText(entry),
        ).not.toBeInTheDocument();
      }
      expect(
        within(accountActions).getByText("auth.logout"),
      ).toBeInTheDocument();
    },
  );

  describe("logging out", () => {
    const renderSidebarAndChooseLogout = async (): Promise<
      ReturnType<typeof vi.fn>
    > => {
      const logout = vi.fn().mockResolvedValue(undefined);
      useAuthMock.mockReturnValue({
        isAuthenticated: true,
        logout,
        user: { email: "zac@example.com", name: "Zac" },
      } as unknown as ReturnType<typeof useAuth>);
      render(
        <MemoryRouter initialEntries={["/projects/project-1"]}>
          <Routes>
            <Route element={<ProjectSidebar />} path="/projects/:projectId" />
            <Route element={<div data-testid="home-page" />} path="/" />
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("canonical-open-items-ready"),
        ).toHaveAttribute("data-ready", "true"),
      );
      fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
      fireEvent.click(screen.getByText("auth.logout"));
      return logout;
    };

    it("warns a demo visitor that logging out ends the demo, and logs out only once confirmed", async () => {
      markDemoSandboxSession(true);

      const logout = await renderSidebarAndChooseLogout();

      expect(screen.getByTestId("demo-logout-confirm")).toBeInTheDocument();
      expect(logout).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("demo-logout-confirm"));

      await waitFor(() => expect(logout).toHaveBeenCalledOnce());
    });

    it("keeps a demo visitor signed in when they cancel the warning", async () => {
      markDemoSandboxSession(true);

      const logout = await renderSidebarAndChooseLogout();
      fireEvent.click(screen.getByTestId("demo-logout-cancel"));

      await waitFor(() =>
        expect(
          screen.queryByTestId("demo-logout-confirm"),
        ).not.toBeInTheDocument(),
      );
      expect(logout).not.toHaveBeenCalled();
    });

    it("logs a real user out straight away", async () => {
      const logout = await renderSidebarAndChooseLogout();

      await waitFor(() => expect(logout).toHaveBeenCalledOnce());
      expect(
        screen.queryByTestId("demo-logout-confirm"),
      ).not.toBeInTheDocument();
    });
  });

  it("renders an Organizations link in the user menu that navigates without a full reload", async () => {
    const OrganizationsPage = () => {
      const location = useLocation();
      return <div data-testid="organizations-page">{location.pathname}</div>;
    };

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
          <Route element={<OrganizationsPage />} path="/organizations" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    const organizationsLink = screen.getByTestId("user-menu-organizations");
    expect(organizationsLink).toHaveAttribute("href", "/organizations");
    expect(organizationsLink).toHaveTextContent("Organizations");

    fireEvent.click(organizationsLink);

    expect(screen.getByTestId("organizations-page")).toHaveTextContent(
      "/organizations",
    );
  });

  it("renders an Admin link in the user menu", async () => {
    usePlatformAdminAccessMock.mockReturnValue({
      isPlatformAdmin: true,
      isResolved: true,
    });
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
          <Route element={<div data-testid="admin-page" />} path="/admin" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    expect(
      screen.queryByTestId("user-menu-organizations-directory"),
    ).not.toBeInTheDocument();
    const adminLink = screen.getByTestId("user-menu-admin");
    expect(adminLink).toHaveAttribute("href", "/admin");

    fireEvent.click(adminLink);

    expect(screen.getByTestId("admin-page")).toBeInTheDocument();
  });

  it("renders the settled empty organization project state without project navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/organizations"]}>
        <Routes>
          <Route element={<OrganizationSidebar />} path="/organizations" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("HeyHey")).toBeInTheDocument();
    expect(screen.getByTestId("organization-projects-empty")).toHaveTextContent(
      "projects.noProjects",
    );
    expect(screen.queryByTestId("explorer-search")).not.toBeInTheDocument();
    expect(screen.queryByTestId("explorer-tree")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Account menu" }),
    ).toBeInTheDocument();
    expect(useProjectsMock).toHaveBeenCalledWith("org-1", {
      enabled: true,
    });
    expect(useProjectPlansMock).not.toHaveBeenCalled();
    expect(useServicesMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ enabled: false, projectId: undefined }),
    );
    expect(useWorkItemTypesMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ enabled: false, projectId: undefined }),
    );
  });

  it("shows a loading organization project state until the collection is ready", async () => {
    useProjectsMock.mockReturnValue({
      error: null,
      isFetched: false,
      isLoading: true,
      isReady: false,
      projects: [],
    } as ReturnType<typeof useProjects>);

    render(
      <MemoryRouter initialEntries={["/organizations"]}>
        <Routes>
          <Route element={<OrganizationSidebar />} path="/organizations" />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("organization-projects-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("organization-projects-empty"),
    ).not.toBeInTheDocument();
  });

  it("renders organization projects with active and onboarding destinations", async () => {
    useProjectsMock.mockReturnValue({
      error: null,
      isFetched: true,
      isLoading: false,
      isReady: true,
      projects: [
        {
          id: "project-active",
          name: "Active Project",
          status: ProjectStatus.Active,
        },
        {
          id: "project-onboarding",
          name: "Onboarding Project",
          status: ProjectStatus.Onboarding,
        },
      ],
    } as ReturnType<typeof useProjects>);

    render(
      <MemoryRouter initialEntries={["/organizations"]}>
        <Routes>
          <Route element={<OrganizationSidebar />} path="/organizations" />
          <Route
            element={<div data-testid="project-destination">project</div>}
            path="/projects/:projectId/*"
          />
        </Routes>
      </MemoryRouter>,
    );

    const activeProjectLink = screen.getByTestId(
      "organization-project-project-active",
    );
    expect(activeProjectLink).toHaveAttribute(
      "href",
      "/projects/project-active",
    );
    expect(activeProjectLink).toHaveAttribute(
      "data-project-id",
      "project-active",
    );
    expect(
      screen.getByTestId("organization-projects-header"),
    ).toHaveTextContent("PROJECTS (2)");
    expect(
      document.querySelectorAll('[data-entity-type="project"]'),
    ).toHaveLength(2);
    expect(
      screen.getByTestId("organization-project-project-onboarding"),
    ).toHaveAttribute("href", "/projects/project-onboarding/onboarding");

    fireEvent.click(activeProjectLink);

    expect(screen.getByTestId("project-destination")).toBeInTheDocument();
  });

  it("opens the shared report flow from the authenticated account menu", async () => {
    explorerSearchState.value = "report";
    render(
      <MemoryRouter initialEntries={["/projects/project-1?tab=activity"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByTestId("report-problem-menu-item"));

    expect(
      screen.getByRole("dialog", { name: "Report a problem" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Product location: /projects/project-1?tab=activity"),
    ).toBeInTheDocument();
  });

  it("renders the explorer tree (with section headers) when the project has no entities", async () => {
    setFeatureFixtures([]);
    useWorkItemsMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItems: [],
    } as unknown as ReturnType<typeof useWorkItems>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(screen.getByTestId("explorer-tree")).toBeInTheDocument();
    const openItemsSection = screen.getByTestId("open-items-section");
    expect(openItemsSection).toHaveTextContent("OPEN (0)");
    expect(openItemsSection.previousElementSibling).toBeNull();
    expect(openItemsSection.nextElementSibling).toHaveAttribute(
      "data-testid",
      "open-items-features-divider",
    );
    expect(screen.queryByText("explorer.noEntities")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("explorer-tree-section-path-work-item:FEATURE"),
    ).toHaveTextContent("/projects/project-1/features");
    expect(
      screen.getByTestId("explorer-tree-section-path-work-item:GOAL"),
    ).toHaveTextContent("/projects/project-1/goals");
  });

  it("keeps Open Items in search results and combines its count with Explorer results", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Sidebar open item",
              taskType: "STANDARD",
            },
          },
          {
            entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Other open item",
              taskType: "STANDARD",
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search menu items" }),
      { target: { value: "sidebar" } },
    );

    expect(screen.getByTestId("open-items-section")).toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("explorer-tree-search-results"),
    ).toHaveTextContent("e8fcc19c-6e24-5444-8754-216f56ad8ca6");
    expect(
      screen.getByTestId("explorer-tree-search-results"),
    ).not.toHaveTextContent("6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e");
    expect(screen.getByTestId("explorer-result-count")).toHaveTextContent("2");
    expect(
      screen.getByTestId("open-items-section").nextElementSibling,
    ).toHaveAttribute("data-testid", "open-items-features-divider");

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search menu items" }),
      { target: { value: "missing" } },
    );

    expect(screen.getByText("OPEN (0)")).toBeInTheDocument();
    expect(screen.getByTestId("explorer-result-count")).toHaveTextContent("0");
    expect(screen.getByTestId("open-items-section")).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search menu items" }),
      { target: { value: "" } },
    );

    expect(screen.getByText("OPEN (2)")).toBeInTheDocument();
    expect(screen.getByTestId("explorer-tree-section-order")).toHaveTextContent(
      "work-item:FEATURE,work-item:GOAL,services",
    );
  });

  it("filters plans, registry sections, and services without moving their rows", async () => {
    setFeatureFixtures([
      {
        id: "3547d177-84e3-5cc3-8b9a-b757e1d6675e",
        name: "Searchable feature",
      },
    ]);
    useWorkItemTypesMock.mockReturnValue({
      error: null,
      isFetched: true,
      isLoading: false,
      isReady: true,
      workItemTypes: [
        {
          id: "feature-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: WORK_ITEM_TYPE_KEYS.Feature,
            name: "Feature",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
        {
          id: "goal-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: WORK_ITEM_TYPE_KEYS.Goal,
            name: "Goal",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
        {
          id: "plan-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: "PLAN",
            name: "Plan",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
        {
          id: "custom-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: "CUSTOM_DELIVERABLE",
            name: "Deliverable",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
      ],
    } as unknown as ReturnType<typeof useWorkItemTypes>);
    useWorkItemsMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItems: [
        {
          id: "3547d177-84e3-5cc3-8b9a-b757e1d6675e",
          name: "Searchable feature",
          status: "ACTIVE",
          type: WORK_ITEM_TYPE_KEYS.Feature,
        },
        {
          id: "6e927405-641c-5194-a25f-fcee78130cf4",
          name: "Roadmap goal",
          status: "ACTIVE",
          type: WORK_ITEM_TYPE_KEYS.Goal,
        },
        {
          id: "268706e6-6827-51f7-ab2e-15db9540a45c",
          name: "Searchable plan",
          status: "ACTIVE",
          type: "PLAN",
        },
        {
          id: "88f2cf5f-869a-5a5f-b5d5-68cd595c3f6e",
          name: "Searchable deliverable",
          status: "ACTIVE",
          type: "CUSTOM_DELIVERABLE",
        },
      ],
    } as unknown as ReturnType<typeof useWorkItems>);
    useServicesMock.mockReturnValue({
      error: null,
      isLoading: false,
      services: [
        {
          id: "service-search",
          name: "Searchable service",
          status: "ACTIVE",
        },
      ],
    } as unknown as ReturnType<typeof useServices>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "38aab9a7-ce44-588e-8042-76781419ab0e",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Searchable open item",
              taskType: "STANDARD",
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search menu items" }),
      { target: { value: "  sEaRcH " } },
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("explorer-tree-section-order"),
      ).toHaveTextContent(
        "work-item:FEATURE,work-item:GOAL,work-item:PLAN,work-item:CUSTOM_DELIVERABLE,services",
      );
    });
    for (const [section, path] of [
      ["work-item:FEATURE", "/projects/project-1/features"],
      ["work-item:GOAL", "/projects/project-1/goals"],
      ["work-item:PLAN", "/projects/project-1/plans"],
      [
        "work-item:CUSTOM_DELIVERABLE",
        "/projects/project-1/collections/CUSTOM_DELIVERABLE",
      ],
      ["services", "/projects/project-1/services"],
    ]) {
      expect(
        screen.getByTestId(`explorer-tree-section-path-${section}`),
      ).toHaveTextContent(path);
    }
    expect(
      screen.getByTestId("explorer-tree-section-work-item:FEATURE"),
    ).toHaveTextContent("3547d177-84e3-5cc3-8b9a-b757e1d6675e");
    expect(
      screen.getByTestId("explorer-tree-section-work-item:GOAL"),
    ).not.toHaveTextContent("6e927405-641c-5194-a25f-fcee78130cf4");
    expect(
      screen.getByTestId("explorer-tree-section-work-item:PLAN"),
    ).toHaveTextContent("268706e6-6827-51f7-ab2e-15db9540a45c");
    expect(
      screen.getByTestId("explorer-tree-section-work-item:CUSTOM_DELIVERABLE"),
    ).toHaveTextContent("88f2cf5f-869a-5a5f-b5d5-68cd595c3f6e");
    expect(
      screen.getByTestId("explorer-tree-section-services"),
    ).toHaveTextContent("service-search");
    expect(screen.getByTestId("explorer-tree-goal-toggle")).toHaveTextContent(
      "GOALS (0)",
    );
    expect(screen.getByTestId("explorer-result-count")).toHaveTextContent("5");
    expect(screen.getByTestId("open-items-section")).toHaveTextContent(
      "OPEN (1)",
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search menu items" }),
      { target: { value: "" } },
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("explorer-tree-section-work-item:GOAL"),
      ).toHaveTextContent("6e927405-641c-5194-a25f-fcee78130cf4");
    });
    expect(
      screen.getByTestId("explorer-tree-section-work-item:PLAN"),
    ).toHaveTextContent("268706e6-6827-51f7-ab2e-15db9540a45c");
    expect(
      screen.queryByTestId("explorer-result-count"),
    ).not.toBeInTheDocument();
  });

  it("keeps the Open Items chrome and sibling Explorer content stable while toggling rows", async () => {
    const storedItems = [
      {
        entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        entityType: "task",
        presentation: {
          kind: "task",
          label: "Sidebar open item",
          taskType: "STANDARD",
        },
      },
      {
        entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
        entityType: "task",
        presentation: {
          kind: "task",
          label: "Other open item",
          taskType: "STANDARD",
        },
      },
    ];
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({ version: 1, items: storedItems }),
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search menu items" }),
      { target: { value: "sidebar" } },
    );

    const openItemsSection = screen.getByTestId("open-items-section");
    const toggle = screen.getByRole("button", { name: "Collapse open" });
    const initialStorage = localStorage.getItem("open-items:v1:project-1");
    expect(openItemsSection).toHaveTextContent("OPEN (1)");
    expect(screen.getByTestId("explorer-result-count")).toHaveTextContent("2");
    expect(
      screen.getByTestId("open-items-features-divider"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("explorer-tree")).toBeInTheDocument();
    expect(screen.getByTestId("explorer-tree-section-order")).toHaveTextContent(
      "work-item:FEATURE,work-item:GOAL,services",
    );
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toBeInTheDocument();

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Expand open" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByTestId("open-items-section")).toHaveTextContent(
      "OPEN (1)",
    );
    expect(screen.getByTestId("explorer-result-count")).toHaveTextContent("2");
    expect(
      screen.getByTestId("open-items-features-divider"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("explorer-tree")).toBeInTheDocument();
    const persistedAfterCollapse = readOpenItemsTestCache("project-1");
    expect(persistedAfterCollapse.items.map((item) => item.entityId)).toEqual(
      storedItems.map((item) => item.entityId),
    );
    expect(persistedAfterCollapse.disclosure).toEqual({
      version: 1,
      sectionExpanded: false,
      collapsedBranchKeys: [],
    });
    expect(persistedAfterCollapse).not.toEqual(
      JSON.parse(initialStorage ?? "null"),
    );
    await waitFor(() => {
      expect(
        screen.queryByTestId(
          "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        ),
      ).not.toBeInTheDocument();
    });
  });

  it("orders configured sections before Plans and Services and filters by exact type without hiding descendants", async () => {
    useWorkItemTypesMock.mockReturnValue({
      error: null,
      isFetched: true,
      isLoading: false,
      isReady: true,
      workItemTypes: [
        {
          id: "feature-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: WORK_ITEM_TYPE_KEYS.Feature,
            name: "Feature",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
        {
          id: "custom-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: "CUSTOM_DELIVERABLE",
            name: "Deliverables",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
        {
          id: "hidden-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: false },
            key: "HIDDEN_TYPE",
            name: "Hidden",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
        {
          id: "omitted-type",
          definition: {
            allowedStatuses: [],
            key: "OMITTED_TYPE",
            name: "Omitted",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
      ],
    } as unknown as ReturnType<typeof useWorkItemTypes>);
    useWorkItemsMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItems: [
        {
          id: "d643c00d-f81b-56e0-836c-aa4b6fe1afc0",
          name: "Root deliverable",
          parentTaskId: null,
          type: "CUSTOM_DELIVERABLE",
        },
        {
          id: "5df1d349-24e7-54c3-90ee-89a9918b9ab6",
          name: "Nested deliverable",
          parentTaskId: "custom-071ae9ab-1d93-54f4-89a9-3560d8a088c6",
          type: "CUSTOM_DELIVERABLE",
        },
        {
          id: "wrong-type",
          name: "Wrong type",
          parentTaskId: null,
          type: "HIDDEN_TYPE",
        },
      ],
    } as unknown as ReturnType<typeof useWorkItems>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(screen.getByTestId("explorer-tree-section-order")).toHaveTextContent(
      "work-item:FEATURE,work-item:CUSTOM_DELIVERABLE,services",
    );
    expect(
      screen.getByTestId("explorer-tree-section-work-item:CUSTOM_DELIVERABLE"),
    ).toHaveTextContent("d643c00d-f81b-56e0-836c-aa4b6fe1afc0");
    expect(
      screen.getByTestId("explorer-tree-section-work-item:CUSTOM_DELIVERABLE"),
    ).toHaveTextContent("5df1d349-24e7-54c3-90ee-89a9918b9ab6");
    expect(
      screen.getByTestId("explorer-tree-section-path-work-item:FEATURE"),
    ).toHaveTextContent("/projects/project-1/features");
    expect(
      screen.getByTestId(
        "explorer-tree-section-path-work-item:CUSTOM_DELIVERABLE",
      ),
    ).toHaveTextContent("/projects/project-1/collections/CUSTOM_DELIVERABLE");
    expect(
      screen.getByTestId(
        "explorer-tree-section-preview-work-item:CUSTOM_DELIVERABLE",
      ),
    ).toHaveTextContent("none");
    expect(
      screen.getByTestId("explorer-tree-section-path-services"),
    ).toHaveTextContent("/projects/project-1/services");
    const rootCollectionCalls = useWorkItemsMock.mock.calls.filter(
      (call) => call[4]?.parentTaskId === null,
    );
    expect(
      new Set(rootCollectionCalls.map((call) => call[4]?.taskType)),
    ).toEqual(new Set(["CUSTOM_DELIVERABLE"]));
    expect(
      screen.queryByTestId("explorer-tree-hidden-type-section"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("explorer-tree-omitted-type-section"),
    ).not.toBeInTheDocument();
  });

  it("withholds all config-driven sections until the registry is ready", async () => {
    useWorkItemTypesMock.mockReturnValue({
      error: null,
      isFetched: false,
      isLoading: true,
      isReady: false,
      workItemTypes: [
        {
          id: "custom-type",
          definition: {
            allowedStatuses: [],
            capabilities: { showsInExplorerSidebar: true },
            key: "CUSTOM_DELIVERABLE",
            name: "Deliverables",
            sections: [],
          },
          projectId: "project-1",
          status: "ACTIVE",
        },
      ],
    } as unknown as ReturnType<typeof useWorkItemTypes>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(screen.getByTestId("explorer-tree-section-order")).toHaveTextContent(
      "services",
    );
    expect(screen.getByTestId("open-items-section")).toBeInTheDocument();
  });

  it("highlights the current Open Items row and updates it when the route changes", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Task One",
              taskType: "STANDARD",
            },
          },
          {
            entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Task Two",
              taskType: "STANDARD",
            },
          },
        ],
      }),
    );

    const LocationProbe = () => {
      const location = useLocation();
      return <div data-testid="location">{location.pathname}</div>;
    };

    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        ]}
      >
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <RouteActivationProbe />
          <RouteControls />
          <LocationProbe />
          <CanonicalOpenItemsReady />
        </OpenItemsProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toHaveAttribute("data-active", "true");
    expect(
      within(
        screen.getByTestId(
          "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        ),
      ).getByRole("link"),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toHaveAttribute("data-active", "false");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );

    fireEvent.click(
      within(
        screen.getByTestId(
          "open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f",
        ),
      ).getByRole("link"),
    );

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/bbc04762-4810-53b6-a5a9-7075c179551f",
    );
    expect(
      within(
        screen.getByTestId(
          "open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f",
        ),
      ).getByRole("link"),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toHaveAttribute("data-active", "false");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );
    expect(
      within(
        screen.getByTestId(
          "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        ),
      ).getByRole("link"),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toHaveAttribute("data-active", "true");

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/bbc04762-4810-53b6-a5a9-7075c179551f",
    );
    expect(
      within(
        screen.getByTestId(
          "open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f",
        ),
      ).getByRole("link"),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toHaveAttribute("data-active", "true");
  });

  it("renders the active Goals section header with its count and toggles open/closed", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    const goalToggle = screen.getByTestId("explorer-tree-goal-toggle");
    expect(goalToggle).toHaveTextContent("GOALS (4) collapsed");

    fireEvent.click(goalToggle);
    expect(screen.getByTestId("explorer-tree-goal-toggle")).toHaveTextContent(
      "GOALS (4) expanded",
    );

    const rootCollectionCalls = useWorkItemsMock.mock.calls.filter(
      (call) => call[4]?.enabled === true,
    );
    expect(
      new Set(rootCollectionCalls.map((call) => call[4]?.taskType)),
    ).toEqual(new Set([WORK_ITEM_TYPE_KEYS.Goal]));
    const featureCall = rootCollectionCalls.find(
      (call) => call[4]?.taskType === WORK_ITEM_TYPE_KEYS.Feature,
    );
    expect(featureCall).toBeUndefined();

    fireEvent.click(screen.getByTestId("explorer-tree-goal-toggle"));
    expect(screen.getByTestId("explorer-tree-goal-toggle")).toHaveTextContent(
      "GOALS (4) collapsed",
    );
  });

  it("loads collapsed section data so its count reflects matching entities", async () => {
    useWorkItemsMock.mockImplementation(
      (_organizationId, _entityType, _projectId, _entityId, options) => {
        if (!options?.enabled) {
          return {
            error: null,
            isLoading: false,
            workItems: [],
          } as unknown as ReturnType<typeof useWorkItems>;
        }

        return {
          error: null,
          isLoading: false,
          workItems: [
            {
              id: "e8fcc19c-6e24-5444-8754-216f56ad8ca6",
              name: "Explorer Sidebar",
              status: "ACTIVE",
              type: WORK_ITEM_TYPE_KEYS.Feature,
            },
            {
              id: "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
              name: "North-star goal",
              status: "ACTIVE",
              type: WORK_ITEM_TYPE_KEYS.Goal,
            },
          ],
        } as unknown as ReturnType<typeof useWorkItems>;
      },
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(
      screen.getByTestId("explorer-tree-feature-toggle"),
    ).toHaveTextContent("FEATURES (1) collapsed");
    expect(screen.getByTestId("explorer-tree-goal-toggle")).toHaveTextContent(
      "GOALS (1) collapsed",
    );

    expect(
      useWorkItemsMock.mock.calls.every((call) => call[4]?.enabled === true),
    ).toBe(true);
  });

  it("keeps all parentless items of a configured type in its section", async () => {
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(screen.getByTestId("explorer-tree-goal-toggle")).toHaveTextContent(
      "GOALS (4)",
    );
  });

  it("keeps a configured section visible when there are no matching items", async () => {
    useWorkItemsMock.mockImplementation(
      (_organizationId, _entityType, _projectId, _entityId, _options) =>
        ({
          error: null,
          isLoading: false,
          workItems: [],
        }) as unknown as ReturnType<typeof useWorkItems>,
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(screen.getByTestId("explorer-tree-goal-toggle")).toHaveTextContent(
      "GOALS (0) collapsed",
    );
  });

  it("keeps the explorer tree available when the root work-item collection fails", async () => {
    useWorkItemsMock.mockReturnValue({
      error: new Error("root work-item request failed"),
      isLoading: false,
      workItems: [],
    } as unknown as ReturnType<typeof useWorkItems>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <Routes>
          <Route element={<ProjectSidebar />} path="/projects/:projectId" />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );

    expect(screen.getByTestId("explorer-tree")).toBeInTheDocument();
    expect(screen.getByTestId("explorer-tree-section-order")).toHaveTextContent(
      "work-item:FEATURE,work-item:GOAL,services",
    );
    expect(screen.queryByText("explorer.error")).not.toBeInTheDocument();
  });
});

function CanonicalOpenItemsReady() {
  const { isLoading, isFetching, pending } = useOpenItems();
  return (
    <span
      hidden
      data-testid="canonical-open-items-ready"
      data-ready={!isLoading && !isFetching && pending === 0}
    />
  );
}
