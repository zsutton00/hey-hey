import { HostedModalFixture } from "../../test/HostedModalFixture";
import { ModalRestoreControls } from "@hey-hey/ui-common/components/Modals";
import { PreviewModal } from "../../components/PreviewModal";
import type {
  TaskResponseDto,
  WorkItemTypeDefinitionDto,
  WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import {
  TaskPriority,
  TargetEntityType,
  WorkItemTypeRole,
  WorkStatus,
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
import { TaskPage } from "./TaskPage";

const {
  mockChildTabsLogInfo,
  mockChildTabsLogWarn,
  mockCreateTask,
  mockInteractionComponent,
  mockNewTaskModal,
  mockUseTaskHierarchy,
  mockUseWorkItem,
} = vi.hoisted(() => ({
  mockUseTaskHierarchy: vi.fn(),
  mockUseWorkItem: vi.fn(),
  mockChildTabsLogInfo: vi.fn(),
  mockChildTabsLogWarn: vi.fn(),
  mockCreateTask: vi.fn(),
  mockInteractionComponent: vi.fn(),
  mockNewTaskModal: vi.fn(),
}));
const mockDataDebugTab = vi.fn();
interface MockCapsuleActionProps {
  id: string;
  label: string;
  actionGroup: string;
  tier: string;
  order: number;
  behavior: string;
  disabled?: boolean;
  iconStyle?: React.CSSProperties;
  onClick?: () => void;
}

const mockCapsuleAction = vi.fn<(props: MockCapsuleActionProps) => null>();
const mockTaskAgentSessionsTab = vi.fn();
const mockWorkItemFilesTab = vi.fn();
const mockWorkItemMetadata = vi.fn();
const mockWorkItemReadView = vi.fn();
const mockWorkItemEditor = vi.fn();
const mockStatusActionUnmount = vi.fn();
const mockSetActiveTab = vi.fn();
const mockSetActiveType = vi.fn();
let mockActiveTab = "data-debug";
let mockActiveType: string | null = null;
let mockHierarchyTask: TaskResponseDto;
let mockHierarchyParent: TaskResponseDto | null = null;
let mockWorkItemTask: TaskResponseDto;
let mockIsPlatformAdmin = true;

interface MockInteractionComponentProps {
  children: React.ReactNode;
  disablePreview?: boolean;
  entityId?: string;
  entityType?: TargetEntityType;
  entityTitle?: string;
  organizationId?: string;
  projectId?: string;
}

const { mockCreateCanonicalPageDescriptor } = vi.hoisted(() => ({
  mockCreateCanonicalPageDescriptor: vi.fn(
    (entityType: string, entityId: string, lineage: unknown) => ({
      entityType,
      entityId,
      lineage,
    }),
  ),
}));

vi.mock("@hey-hey/ui-common", () => ({
  createNavigationLineageEntry: (entityType: string, entityId: string) => ({
    entityType,
    entityId,
  }),
}));

vi.mock("nuqs", () => ({
  parseAsString: {
    withDefault: (value: string) => value,
  },
  useQueryState: (key: string) =>
    key === "type"
      ? [mockActiveType, mockSetActiveType]
      : [mockActiveTab, mockSetActiveTab],
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

vi.mock("@hey-hey/ui-common/clients", () => ({
  unifiedApiClient: {
    client: {
      createServiceLink: vi.fn(),
      removeServiceLink: vi.fn(),
    },
  },
}));

const mockEntityGrid = vi.fn();
const mockUseWorkItems = vi.fn();

vi.mock("@hey-hey/ui-common/components", () => ({
  DependentFutures: ({ taskId }: { taskId: string }) => (
    <div data-testid="dependent-futures" data-task-id={taskId} />
  ),
  Card: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CapsuleAction: (props: MockCapsuleActionProps) => {
    mockCapsuleAction(props);
    return null;
  },
  DiscussCapsuleAction: () => null,
  EntityGrid: (props: {
    items?: TaskResponseDto[];
    renderItem?: (item: TaskResponseDto) => React.ReactNode;
  }) => {
    mockEntityGrid(props);
    return (
      <div data-testid="entity-grid">
        {props.items?.map((item) => (
          <React.Fragment key={item.id}>
            {props.renderItem?.(item)}
          </React.Fragment>
        ))}
      </div>
    );
  },
  EntityListItem: () => null,
  taskAdapter: {
    toEntityListItemProps: vi.fn(() => ({ title: "item", status: null })),
  },
  useSiteChat: () => ({
    id: "site-chat",
    label: "Site Chat",
    icon: null,
    disabled: false,
    title: "Site Chat",
  }),
  useTaskGenerationCapsuleAction: () => ({
    id: "task-generation",
    label: "Tasks",
    icon: null,
    disabled: false,
    title: "Tasks",
  }),
  WorkItemEditor: (props: {
    workItemId: string;
    onDone?: (workItemId: string) => void;
  }) => {
    mockWorkItemEditor(props);
    return (
      <button
        type="button"
        data-testid="work-item-editor-done"
        onClick={() => props.onDone?.(props.workItemId)}
      >
        Done
      </button>
    );
  },
  WorkItemMetadata: (props: unknown) => {
    mockWorkItemMetadata(props);
    return <div data-testid="work-item-metadata" />;
  },
  WorkItemReadView: (props: unknown) => {
    mockWorkItemReadView(props);
    return <div data-testid="work-item-read-view" />;
  },
  WorkItemEntityFilters: () => null,
  useFilteredWorkItems: <T,>(items: T[]) => items,
  WorkItemUnsavedChangesBridge: ({ children }: { children: React.ReactNode }) =>
    children,
  InteractionComponent: (props: MockInteractionComponentProps) => {
    mockInteractionComponent(props);
    return <>{props.children}</>;
  },
  EntityIcon: () => null,
  EntityNodeStatusChip: () => null,
  MentionBadgeInner: () => null,
}));

vi.mock("@hey-hey/ui-common/context", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/context")>()),
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
  createCanonicalPageDescriptor: mockCreateCanonicalPageDescriptor,
  TrackingProvider: ({
    children,
    context,
  }: {
    children: React.ReactNode;
    context: {
      attentionEntity?: {
        id: string;
        lineage?: ReadonlyArray<{ entityType: string; entityId: string }>;
      };
    };
  }) => (
    <div
      data-testid="tracking-provider"
      data-attention-entity={context.attentionEntity?.id ?? ""}
      data-attention-lineage={JSON.stringify(
        context.attentionEntity?.lineage ?? null,
      )}
    >
      {children}
    </div>
  ),
}));

const createDefinition = (
  overrides: Partial<WorkItemTypeDefinitionDto> = {},
): WorkItemTypeDefinitionDto => ({
  key: "STANDARD",
  name: "Task",
  sections: [
    { key: "description", label: "Description" },
    { key: "acceptanceCriteria", label: "Acceptance Criteria" },
  ],
  allowedStatuses: [],
  allowedParentTypes: [],
  role: WorkItemTypeRole.WorkItem,
  capabilities: {
    planEligible: true,
  },
  ...overrides,
});

const asSummary = (
  definition: WorkItemTypeDefinitionDto,
  overrides: Partial<Pick<WorkItemTypeSummaryDto, "projectId" | "status">> = {},
): WorkItemTypeSummaryDto =>
  ({
    definition,
    projectId: "project-1",
    status: "ACTIVE",
    ...overrides,
  }) as WorkItemTypeSummaryDto;

let mockWorkItemTypeDefinition: WorkItemTypeDefinitionDto | undefined;
let mockWorkItemTypes: WorkItemTypeSummaryDto[];
let mockWorkItemTypesFetched = true;
let mockVisibleChildren: TaskResponseDto[] = [];

vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: () => ({
    isPlatformAdmin: mockIsPlatformAdmin,
    isResolved: true,
  }),
  // Cached hierarchy unavailable, so pages use the server-derived ancestry.
  useFeatureLookup: () => ({
    isReady: false,
    isLoading: false,
    get: () => undefined,
    resolveAncestry: () => ({ ancestors: [], complete: false }),
  }),
  useFullEntityContext: () => ({
    data: null,
    isLoading: false,
    isFetched: false,
    error: null,
    refetch: vi.fn(),
  }),
  useInitiative: () => ({
    data: { id: "initiative-1", name: "Initiative" },
    isLoading: false,
    error: null,
  }),
  useProject: () => ({
    data: { id: "project-1", name: "Project" },
  }),
  useTaskHierarchy: (...args: unknown[]) => {
    mockUseTaskHierarchy(...args);
    return {
      hierarchy: {
        task: mockHierarchyTask,
        parent: mockHierarchyParent,
        children: [],
      },
      isLoading: false,
      error: null,
    };
  },
  useWorkItem: (...args: unknown[]) => {
    mockUseWorkItem(...args);
    return {
      workItem: mockWorkItemTask,
      refetch: vi.fn(),
    };
  },
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: mockWorkItemTypeDefinition,
    isLoading: false,
    isFetched: true,
    error: null,
  }),
  useAllowedChildWorkItemTypes: (
    _organizationId: string,
    projectId: string,
    parentType: string,
  ) => ({
    workItemTypes: mockWorkItemTypes,
    isLoading: !mockWorkItemTypesFetched,
    isFetched: mockWorkItemTypesFetched,
    isReady: mockWorkItemTypesFetched,
    error: null,
    allowedChildTypes: mockWorkItemTypesFetched
      ? mockWorkItemTypes
          .filter(
            ({ definition, projectId: definitionProjectId, status }) =>
              definitionProjectId === projectId &&
              status === "ACTIVE" &&
              definition.allowedParentTypes?.includes(parentType) === true,
          )
          .map(({ definition }) => definition.key)
      : undefined,
  }),
  useWorkItemTypes: () => ({
    workItemTypes: mockWorkItemTypes,
    isLoading: !mockWorkItemTypesFetched,
    isFetched: mockWorkItemTypesFetched,
    error: null,
  }),
  useWorkItems: (...args: unknown[]) => {
    mockUseWorkItems(...args);
    return {
      createTask: mockCreateTask,
      remove: vi.fn(),
      workItems: mockVisibleChildren,
    };
  },
  useWorkItemUpdateMethods: () => ({
    updateTask: vi.fn(),
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({
    currentOrgId: "org-1",
  }),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: (value: string) => value,
  TERMS: {
    Task: "Task",
    Tasks: "Tasks",
  },
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    initiativeDetail: () => "/initiative",
    returnToProject: () => "/project",
    task: () => "/task",
  },
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
  getWorkItemContentFromSections: vi.fn(() => ({})),
  selectWorkItemSections: ({
    typeKey,
    definition,
    isFetched,
  }: {
    typeKey?: string;
    definition?: WorkItemTypeDefinitionDto;
    isFetched: boolean;
  }) => {
    if (!typeKey) return { status: "unavailable", reason: "missing-type" };
    if (!isFetched) return { status: "unavailable", reason: "loading" };
    if (!definition || definition.key !== typeKey) {
      return { status: "unavailable", reason: "unresolved" };
    }
    return { status: "resolved", typeKey, sections: definition.sections };
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: () => null,
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DetailPageBody: ({
    content,
    sidebar,
    contextualRail,
  }: {
    content: React.ReactNode;
    sidebar: React.ReactNode;
    contextualRail?: { expanded: boolean; onToggle: () => void };
  }) => (
    <>
      {content}
      {contextualRail && (
        <button type="button" onClick={contextualRail.onToggle}>
          {contextualRail.expanded ? "Hide Context" : "Show Context"}
        </button>
      )}
      {contextualRail?.expanded && sidebar}
    </>
  ),
  DetailPageSidebar: ({ metadata }: { metadata: React.ReactNode }) => (
    <>{metadata}</>
  ),
  DetailPageHeader: ({ title }: { title: string }) => <div>{title}</div>,
  DetailPageTabs: ({
    tabs,
    onChange,
  }: {
    tabs: Array<{ value: string; label: string }>;
    onChange?: (value: string) => void;
  }) => (
    <div data-testid="detail-page-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          data-tab-value={tab.value}
          onClick={() => onChange?.(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./TaskDetailSidebar", () => ({
  TaskDetailSidebar: () => (
    <aside data-testid="task-detail-sidebar">
      <div>Feature Tree</div>
      <div>Related Card</div>
    </aside>
  ),
}));

vi.mock("../../components/SiteChatModal", () => ({
  SiteChatModal: () => null,
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: () => null,
  buildAdminMetadataItems: () => [],
}));

vi.mock("../../components/Tabs/ConversationListTab", () => ({
  ConversationListTab: () => null,
}));

vi.mock("../../components/Tabs/DesignDocsTab", () => ({
  DesignDocsTab: () => null,
}));

vi.mock("../../components/Tabs/DataDebugTab", () => ({
  DataDebugTab: (props: unknown) => {
    mockDataDebugTab(props);
    return <div>data-debug</div>;
  },
}));

vi.mock("../../components/Tabs/WorkItemFilesTab", () => ({
  WorkItemFilesTab: (props: unknown) => {
    mockWorkItemFilesTab(props);
    return <div>work-item-files</div>;
  },
  isFilesTabSupported: ({
    status,
    typeKey,
  }: {
    status: string;
    typeKey?: string;
  }) =>
    status === "resolved" &&
    (typeKey === "FEATURE" || typeKey === "STANDARD" || typeKey === "BUG"),
}));

vi.mock("../../components/Tabs/TaskTab", () => ({
  TaskTab: () => null,
}));

vi.mock("../../components/Tasks", () => ({
  NewTaskModal: (props: unknown) => {
    mockNewTaskModal(props);
    return null;
  },
}));

vi.mock("../../utils/routeTransitions", () => ({
  tabTransitionVariants: {},
}));

vi.mock("../../utils/statusUtils", () => ({
  isTaskRefining: () => false,
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: mockChildTabsLogInfo,
    warn: mockChildTabsLogWarn,
  },
}));

vi.mock("./SetReadyActionCapsule", () => ({
  SetReadyActionCapsule: () => {
    React.useEffect(() => () => mockStatusActionUnmount(), []);
    return <div data-testid="status-action-owner" />;
  },
}));

vi.mock("./TaskAgentSessionsTab", () => ({
  TaskAgentSessionsTab: (props: unknown) => {
    mockTaskAgentSessionsTab(props);
    return <div>Start New Session</div>;
  },
}));

const createTask = (
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto =>
  ({
    id: "task-1",
    name: "Task",
    type: "STANDARD",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Low,
    initiativeId: "initiative-1",
    serviceRelations: [],
    sections: [],
    childCounts: { total: 0 },
    designDocCount: 0,
    codingSessionCount: 0,
    agentSessionCount: 0,
    ...overrides,
  }) as TaskResponseDto;

const renderTaskPage = (
  initialEntry: string,
  preview = false,
  projectId = "project-1",
): void => {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/projects/:projectId/initiatives/:initiativeId/tasks/:taskId"
          element={
            <TaskPage
              organizationId="org-1"
              projectId={projectId}
              initiativeId="initiative-1"
              taskId="task-1"
              preview={preview}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
};

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
};

describe("TaskPage data debug tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = "data-debug";
    mockIsPlatformAdmin = true;
    mockHierarchyTask = createTask();
    mockHierarchyParent = null;
    mockWorkItemTask = createTask();
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];
    mockWorkItemTypesFetched = true;
    mockVisibleChildren = [];
    mockWorkItemFilesTab.mockReset();
  });

  it("preserves the actual canonical task composition and its context through Preview minimize and restore", async () => {
    mockActiveTab = "task";
    render(
      <MemoryRouter initialEntries={["/underlying?tab=notes"]}>
        <LocationProbe />
        <HostedModalFixture>
          <PreviewModal open onClose={vi.fn()}>
            <TaskPage
              organizationId="org-1"
              projectId="project-1"
              taskId="task-1"
              preview
            />
          </PreviewModal>
          <ModalRestoreControls />
        </HostedModalFixture>
      </MemoryRouter>,
    );
    const composition = screen.getByTestId("status-action-owner");
    expect(screen.getByText("Feature Tree")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Hide Context" }));
    expect(screen.queryByText("Feature Tree")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("modal-minimize"));
    fireEvent.click(screen.getByRole("button", { name: "Restore Preview" }));
    await waitFor(() =>
      expect(screen.getByTestId("status-action-owner")).toBeVisible(),
    );
    expect(screen.getByTestId("status-action-owner")).toBe(composition);
    expect(mockStatusActionUnmount).not.toHaveBeenCalled();
    expect(screen.queryByText("Feature Tree")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/underlying?tab=notes",
    );
  });

  it("keeps the capsule mutation owner alive through optimistic completion until the page closes", () => {
    mockActiveTab = "task";
    mockHierarchyTask = createTask({ status: WorkStatus.Active });
    mockWorkItemTask = mockHierarchyTask;
    const page = () => (
      <MemoryRouter>
        <TaskPage
          organizationId="org-1"
          projectId="project-1"
          initiativeId="initiative-1"
          taskId="task-1"
        />
      </MemoryRouter>
    );
    const view = render(page());
    expect(screen.getByTestId("status-action-owner")).toBeInTheDocument();
    mockHierarchyTask = { ...mockHierarchyTask, status: WorkStatus.Completed };
    mockWorkItemTask = mockHierarchyTask;
    view.rerender(page());
    expect(mockStatusActionUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("status-action-owner")).toBeInTheDocument();
    view.unmount();
    expect(mockStatusActionUnmount).toHaveBeenCalledTimes(1);
  });

  it("starts Mockup context collapsed and lets users reopen and close both cards", () => {
    mockActiveTab = "task";
    mockHierarchyTask = createTask({ type: "mockup" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "mockup",
      name: "Mockup",
    });
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Show Context" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("task-detail-sidebar")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show Context" }));
    expect(screen.getByText("Feature Tree")).toBeInTheDocument();
    expect(screen.getByText("Related Card")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide Context" }));
    expect(screen.queryByTestId("task-detail-sidebar")).not.toBeInTheDocument();
  });

  it("re-reads its own task and hierarchy each time the page opens", () => {
    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(mockUseTaskHierarchy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "task-1",
      expect.objectContaining({ refetchOnMount: true }),
    );
    expect(mockUseWorkItem).toHaveBeenCalledWith(
      expect.anything(),
      "task",
      "task-1",
      expect.objectContaining({ refetchOnMount: true }),
    );
  });

  it("keeps ordinary work-item context expanded initially", () => {
    mockActiveTab = "task";
    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Hide Context" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Feature Tree")).toBeInTheDocument();
    expect(screen.getByText("Related Card")).toBeInTheDocument();
    expect(screen.getByTestId("dependent-futures")).toHaveAttribute(
      "data-task-id",
      "task-1",
    );
  });

  it("supplies the canonical Bug identity to dependent future navigation", () => {
    mockActiveTab = "task";
    mockHierarchyTask = createTask({ type: "BUG" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({ key: "BUG", name: "Bug" });
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];
    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");
    expect(screen.getByTestId("dependent-futures")).toHaveAttribute(
      "data-task-id",
      "task-1",
    );
  });

  it("suppresses self-Preview while keeping child work-item interactions default", async () => {
    mockActiveTab = "children:STANDARD";
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(
        createDefinition({
          key: "STANDARD",
          allowedParentTypes: ["STANDARD"],
        }),
      ),
    ];
    mockVisibleChildren = [createTask({ id: "child-1", name: "Child task" })];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    await waitFor(() => {
      expect(mockInteractionComponent).toHaveBeenCalledWith(
        expect.objectContaining({
          disablePreview: true,
          entityId: "task-1",
          entityType: TargetEntityType.Task,
        }),
      );
    });

    const childProps = mockInteractionComponent.mock.calls
      .map(([props]) => props as MockInteractionComponentProps)
      .find((props) => props.entityId === "child-1");
    expect(childProps).toEqual(
      expect.objectContaining({
        entityId: "child-1",
        entityType: TargetEntityType.Task,
      }),
    );
    expect(childProps).not.toHaveProperty("disablePreview");
  });

  it("returns clean work-item editing to the same route and preserves tab context", async () => {
    mockActiveTab = "task";
    renderTaskPage(
      "/projects/project-1/initiatives/initiative-1/tasks/task-1?editing=true&tab=task&planId=plan-1",
    );

    await waitFor(() => {
      expect(screen.getByTestId("work-item-editor-done")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("work-item-editor-done"));

    expect(screen.getByTestId("work-item-read-view")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/initiatives/initiative-1/tasks/task-1?tab=task&planId=plan-1",
    );
    expect(mockWorkItemEditor).toHaveBeenCalledWith(
      expect.objectContaining({ workItemId: "task-1" }),
    );
  });

  it("leaves the Tasks Edit color to the shared Action Capsule variation", () => {
    mockActiveTab = "task";

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    const editAction = mockCapsuleAction.mock.calls
      .map(([props]) => props)
      .find((props) => props.id === "edit-task");

    expect(editAction).toEqual(
      expect.objectContaining({
        id: "edit-task",
        label: "Edit",
        actionGroup: "page",
        tier: "page",
        order: 100,
        behavior: "click",
        disabled: false,
        onClick: expect.any(Function),
      }),
    );
    expect(editAction).not.toHaveProperty("iconStyle");
  });

  it("loads data debug tab from the plan perspective when planId is present", async () => {
    renderTaskPage(
      "/projects/project-1/initiatives/initiative-1/tasks/task-1?planId=plan-1",
    );

    await waitFor(() => {
      expect(screen.getByText("data-debug")).toBeInTheDocument();
    });

    expect(mockDataDebugTab).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        entityId: "plan-1",
        entityType: "task",
      }),
    );
  });

  it("omits canonical attention activation in Preview", async () => {
    mockActiveTab = "task";
    renderTaskPage(
      "/projects/project-1/initiatives/initiative-1/tasks/task-1?editing=true&planId=plan-1",
      true,
    );

    await waitFor(() => {
      expect(screen.getByTestId("tracking-provider")).toHaveAttribute(
        "data-attention-entity",
        "",
      );
    });
  });

  it("falls back to the task when no planId is present", async () => {
    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    await waitFor(() => {
      expect(screen.getByText("data-debug")).toBeInTheDocument();
    });

    expect(screen.getByTestId("tracking-provider")).toHaveAttribute(
      "data-attention-lineage",
      JSON.stringify([{ entityType: "task", entityId: "task-1" }]),
    );

    expect(mockDataDebugTab).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        entityId: "task-1",
        entityType: "task",
      }),
    );
  });

  it("includes the resolved parent task in the canonical task lineage", async () => {
    mockHierarchyParent = createTask({
      id: "feature-1",
      name: "Parent feature",
      type: "FEATURE",
    });

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    await waitFor(() => {
      expect(screen.getByText("data-debug")).toBeInTheDocument();
    });

    expect(mockCreateCanonicalPageDescriptor).toHaveBeenLastCalledWith(
      "task",
      "task-1",
      [
        { entityType: "task", entityId: "feature-1" },
        { entityType: "task", entityId: "task-1" },
      ],
      { kind: "task", label: "Task", taskType: "STANDARD" },
    );
  });

  it("shows coding session count when it is greater than zero", () => {
    mockHierarchyTask = createTask({ codingSessionCount: 3 });

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Agent Sessions (3)" }),
    ).toBeInTheDocument();
  });

  it("hides a zero coding session count in the tab label", () => {
    mockHierarchyTask = createTask({ codingSessionCount: 0 });
    mockWorkItemTask = createTask({ codingSessionCount: 5 });

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Agent Sessions" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Agent Sessions (0)" }),
    ).not.toBeInTheDocument();
  });

  it("shows agent session count on conversations tab", () => {
    mockHierarchyTask = createTask({ agentSessionCount: 4 });

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Conversations (4)" }),
    ).toBeInTheDocument();
  });

  it("renders the coding sessions tab content when selected", () => {
    mockActiveTab = "agent-sessions";

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(screen.getByText("Start New Session")).toBeInTheDocument();
    expect(mockTaskAgentSessionsTab).toHaveBeenCalledWith(
      expect.objectContaining({ enableFilters: false }),
    );
  });

  it.each(["STANDARD", "BUG"])(
    "keeps coding sessions available for the built-in %s work-item role",
    (type) => {
      mockHierarchyTask = createTask({ type });
      mockWorkItemTask = mockHierarchyTask;
      mockWorkItemTypeDefinition = createDefinition({ key: type });
      mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];

      renderTaskPage(
        "/projects/project-1/initiatives/initiative-1/tasks/task-1",
      );

      expect(
        screen.getByRole("button", { name: "Agent Sessions" }),
      ).toBeInTheDocument();
    },
  );

  it("shows coding sessions for a custom work-item role without a type-key allow-list", () => {
    mockHierarchyTask = createTask({ type: "EVAL" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "EVAL",
      name: "Evaluation",
    });
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Agent Sessions" }),
    ).toBeInTheDocument();
  });

  it("hides coding sessions for non-work-item roles despite unrelated capabilities", () => {
    mockHierarchyTask = createTask({ type: "FEATURE" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "FEATURE",
      name: "Feature",
      role: WorkItemTypeRole.ProjectInfo,
      capabilities: { planEligible: true },
    });
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.queryByRole("button", { name: "Agent Sessions" }),
    ).not.toBeInTheDocument();
  });

  it("hides coding sessions while the type definition is unavailable", () => {
    mockWorkItemTypeDefinition = undefined;
    mockWorkItemTypes = [];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.queryByRole("button", { name: "Agent Sessions" }),
    ).not.toBeInTheDocument();
  });

  it("hides the data debug tab when debug access is disabled", () => {
    mockIsPlatformAdmin = false;

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.queryByRole("button", { name: "Data Debug" }),
    ).not.toBeInTheDocument();
  });

  it("exposes the production Files tab for a supported resolved type", () => {
    mockActiveTab = "files";
    mockHierarchyTask = createTask({ type: "FEATURE" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "FEATURE",
      name: "Feature",
    });
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument();
    expect(screen.getByText("work-item-files")).toBeInTheDocument();
    expect(mockWorkItemFilesTab).toHaveBeenCalledWith(
      expect.objectContaining({ typeKey: "FEATURE", entityId: "task-1" }),
    );
  });
});

describe("TaskPage dynamic children tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = "task";
    mockActiveType = null;
    mockIsPlatformAdmin = false;
    mockHierarchyTask = createTask();
    mockWorkItemTask = createTask();
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];
    mockWorkItemTypesFetched = true;
  });

  it("fails closed when the work-item type definition is unresolved", () => {
    mockWorkItemTypeDefinition = undefined;
    mockWorkItemTypes = [];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.queryByRole("button", { name: "Task" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tasks" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Agent Sessions" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("work-item-metadata")).not.toBeInTheDocument();
  });

  it("renders child tabs from child-owned allowed parent types", () => {
    mockHierarchyTask = createTask({ type: "MARKETING" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "MARKETING",
      name: "Campaign",
      sections: [
        { key: "description", label: "Brief" },
        { key: "audience", label: "Audience" },
      ],
    });
    const childDefinition = createDefinition({
      key: "CAMPAIGN_TASK",
      name: "Campaign Task",
      allowedParentTypes: ["MARKETING"],
    });
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(childDefinition),
    ];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Campaign" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Work Items" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Campaign Task" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tasks" }),
    ).not.toBeInTheDocument();
    expect(mockWorkItemReadView).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionSelection: expect.objectContaining({
          status: "resolved",
          sections: [
            { key: "description", label: "Brief" },
            { key: "audience", label: "Audience" },
          ],
        }),
      }),
    );
  });

  it("places coding sessions immediately after the task overview", () => {
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(
        createDefinition({
          key: "BUG",
          name: "Bug",
          allowedParentTypes: ["STANDARD"],
        }),
      ),
    ];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    const tabValues = Array.from(
      screen.getByTestId("detail-page-tabs").querySelectorAll("button"),
    ).map((tab) => tab.getAttribute("data-tab-value"));

    expect(tabValues.slice(0, 5)).toEqual([
      "task",
      "agent-sessions",
      WorkItemTypeRole.WorkItem,
      "files",
      "documents",
    ]);
  });

  it("defaults a selected Work Items role tab to Standard", () => {
    mockHierarchyTask = createTask({ type: "PARENT" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "PARENT",
      name: "Parent",
    });
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(
        createDefinition({
          key: "BUG",
          name: "Bug",
          allowedParentTypes: ["PARENT"],
        }),
      ),
      asSummary(
        createDefinition({
          key: "STANDARD",
          name: "Task",
          allowedParentTypes: ["PARENT"],
        }),
      ),
    ];
    mockActiveTab = WorkItemTypeRole.WorkItem;
    mockActiveType = null;

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        parentTaskId: "task-1",
        taskType: "STANDARD",
        enabled: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Work Items" }));

    expect(
      mockSetActiveTab.mock.calls.some(
        ([value]) => value === WorkItemTypeRole.WorkItem,
      ),
    ).toBe(true);
    expect(mockSetActiveType).toHaveBeenCalledWith("STANDARD");
  });

  it("renders each visible child type as a subtab in its registry role", () => {
    mockHierarchyTask = createTask({ type: "MARKETING" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "MARKETING",
      name: "Campaign",
    });
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(
        createDefinition({
          key: "CAMPAIGN_TASK",
          name: "Campaign Task",
          allowedParentTypes: ["MARKETING"],
        }),
      ),
    ];
    mockActiveTab = WorkItemTypeRole.WorkItem;
    mockActiveType = "CAMPAIGN_TASK";

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Work Items" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Campaign Task" }),
    ).toBeInTheDocument();
  });

  it("exposes the exact active Standard child set from the inverse relationship index", () => {
    const childDefinitions = [
      createDefinition({
        key: "BUG",
        name: "Bug",
        allowedParentTypes: ["STANDARD"],
      }),
      createDefinition({
        key: "STANDARD",
        name: "Task",
        allowedParentTypes: ["STANDARD"],
      }),
      createDefinition({
        key: "TASK_MONITOR",
        name: "Task Monitor",
        allowedParentTypes: ["STANDARD"],
      }),
      createDefinition({
        key: "workflow",
        name: "Workflow",
        allowedParentTypes: ["STANDARD"],
      }),
    ];
    const archivedDefinition = createDefinition({
      key: "ARCHIVED",
      name: "Archived Child",
      allowedParentTypes: ["STANDARD"],
    });
    const crossProjectDefinition = createDefinition({
      key: "OTHER_PROJECT",
      name: "Other Project Child",
      allowedParentTypes: ["STANDARD"],
    });
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      ...childDefinitions.map((definition) => asSummary(definition)),
      asSummary(archivedDefinition, { status: "ARCHIVED" }),
      asSummary(crossProjectDefinition, { projectId: "project-2" }),
    ];
    mockActiveTab = WorkItemTypeRole.WorkItem;
    mockActiveType = "STANDARD";

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Work Items" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bugs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Task Monitor" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Workflow" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Contracts" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archived Child" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Other Project Child" }),
    ).not.toBeInTheDocument();
  });

  it("fails closed for custom children when the page has no project context", () => {
    mockActiveTab = "children:MARKETING";
    const activeCustomDefinition = createDefinition({
      key: "MARKETING",
      name: "Campaign",
      allowedParentTypes: ["STANDARD"],
    });
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(activeCustomDefinition),
    ];

    renderTaskPage(
      "/projects/project-1/initiatives/initiative-1/tasks/task-1",
      false,
      "",
    );

    expect(
      mockSetActiveTab.mock.calls.some(([value]) => value === "task"),
    ).toBe(true);
    expect(mockEntityGrid).not.toHaveBeenCalled();

    const childQueryCall = mockUseWorkItems.mock.calls.find((args) => {
      const options = args[4] as
        | { parentTaskId?: string; taskType?: string; enabled?: boolean }
        | undefined;
      return (
        options?.parentTaskId === "task-1" && options.taskType === "MARKETING"
      );
    });
    expect(childQueryCall?.[4]).toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("does not redirect a child URL while the type registry is loading", () => {
    mockActiveTab = "children:STANDARD";
    mockWorkItemTypesFetched = false;
    mockWorkItemTypes = [];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(mockSetActiveTab).not.toHaveBeenCalledWith("task");
  });

  it("uses an active custom child definition for the generic creation path", () => {
    mockActiveTab = "children:MARKETING";
    const activeCustomDefinition = createDefinition({
      key: "MARKETING",
      name: "Campaign",
      allowedParentTypes: ["STANDARD"],
    });
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(activeCustomDefinition),
    ];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(mockEntityGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        createButtonLabel: "Add Campaign",
        showCreateButton: true,
      }),
    );
  });

  it("submits only keys declared by the selected custom child definition", async () => {
    mockActiveTab = "children:MARKETING";
    const activeCustomDefinition = createDefinition({
      key: "MARKETING",
      name: "Campaign",
      allowedParentTypes: ["STANDARD"],
      allowedStatuses: [WorkStatus.Active],
      sections: [
        { key: "audience", label: "Audience" },
        { key: "brief", label: "Brief" },
      ],
    });
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(activeCustomDefinition),
    ];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    const props = mockNewTaskModal.mock.calls.at(-1)?.[0] as {
      onSubmit: (formData: {
        name: string;
        initiativeId: string;
        status: WorkStatus;
        sectionContent: Record<string, string>;
      }) => Promise<void>;
    };
    await act(async () => {
      await props.onSubmit({
        name: "Campaign child",
        initiativeId: "initiative-1",
        status: WorkStatus.RefiningDescription,
        sectionContent: {
          audience: "Operators",
          brief: "Launch",
          acceptanceCriteria: "must be discarded",
        },
      });
    });

    expect(mockCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MARKETING",
        status: WorkStatus.Active,
        sections: [
          { key: "audience", content: "Operators", order: 0 },
          { key: "brief", content: "Launch", order: 1 },
        ],
      }),
    );
  });

  it("withholds child creation when the selected type has no initial status", async () => {
    mockActiveTab = "children:MARKETING";
    const activeCustomDefinition = createDefinition({
      key: "MARKETING",
      name: "Campaign",
      allowedParentTypes: ["STANDARD"],
      allowedStatuses: [],
    });
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(activeCustomDefinition),
    ];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    const props = mockNewTaskModal.mock.calls.at(-1)?.[0] as {
      onSubmit: (formData: {
        name: string;
        initiativeId: string;
        sectionContent: Record<string, string>;
      }) => Promise<void>;
    };
    await act(async () => {
      await props.onSubmit({
        name: "Campaign child",
        initiativeId: "initiative-1",
        sectionContent: {},
      });
    });

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  it("falls back from an unavailable child URL without enabling its query", () => {
    mockActiveTab = "children:ARCHIVED";
    const archivedDefinition = createDefinition({
      key: "ARCHIVED",
      name: "Archived Child",
      allowedParentTypes: ["STANDARD"],
    });
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(archivedDefinition, { status: "ARCHIVED" }),
    ];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      mockSetActiveTab.mock.calls.some(([value]) => value === "task"),
    ).toBe(true);
    expect(screen.queryByTestId("entity-grid")).not.toBeInTheDocument();

    const childQueryCall = mockUseWorkItems.mock.calls.find((args) => {
      const options = args[4] as
        | { parentTaskId?: string; taskType?: string; enabled?: boolean }
        | undefined;
      return (
        options?.parentTaskId === "task-1" && options.taskType === "ARCHIVED"
      );
    });
    expect(childQueryCall?.[4]).toEqual(
      expect.objectContaining({ enabled: false }),
    );
    expect(mockChildTabsLogWarn).toHaveBeenCalledWith(
      "ui",
      expect.stringContaining("[child tabs] TaskPage rejected child route\n{"),
    );
    expect(mockChildTabsLogWarn).toHaveBeenCalledWith(
      "ui",
      expect.stringContaining('"rejectedChildType": "ARCHIVED"'),
    );
  });

  it("keeps an archived parent definition available for read rendering", () => {
    mockHierarchyTask = createTask({
      type: "ARCHIVED_PARENT",
      name: "Archived parent item",
    });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "ARCHIVED_PARENT",
      name: "Archived Parent",
    });
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition, { status: "ARCHIVED" }),
    ];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Archived Parent" }),
    ).toBeInTheDocument();
    expect(mockWorkItemReadView).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionSelection: expect.objectContaining({ status: "resolved" }),
      }),
    );
  });

  it("renders EntityGrid when a children: tab is active", async () => {
    mockActiveTab = "children:STANDARD";
    mockWorkItemTypeDefinition = createDefinition();
    mockWorkItemTypes = [
      asSummary(mockWorkItemTypeDefinition),
      asSummary(
        createDefinition({
          key: "STANDARD",
          allowedParentTypes: ["STANDARD"],
        }),
      ),
    ];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    await waitFor(() => {
      expect(screen.getByTestId("entity-grid")).toBeInTheDocument();
    });

    const childQueryCall = mockUseWorkItems.mock.calls.find((args) => {
      const options = args[4] as { taskType?: string; enabled?: boolean };
      return options?.taskType === "STANDARD";
    });
    expect(childQueryCall?.[4]).toEqual(
      expect.objectContaining({ enabled: true }),
    );
    expect(mockChildTabsLogInfo).toHaveBeenCalledWith(
      "ui",
      expect.stringContaining(
        '[child tabs] TaskPage state\n{\n  "page": "task"',
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

  it("renders Contract as description-only without task-shaped chrome", () => {
    mockHierarchyTask = createTask({ type: "CONTRACT", name: "API handoff" });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "CONTRACT",
      name: "Contract",
      role: WorkItemTypeRole.ProjectInfo,
      sections: [{ key: "description", label: "Description" }],
      capabilities: {
        planEligible: false,
      },
    });
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(
      screen.getByRole("button", { name: "Contract" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Agent Sessions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tasks" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("work-item-metadata")).not.toBeInTheDocument();
    expect(mockWorkItemReadView).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionSelection: expect.objectContaining({
          status: "resolved",
          sections: [{ key: "description", label: "Description" }],
        }),
      }),
    );
  });

  it("passes approved MODE sections through the canonical shared read view", () => {
    mockActiveTab = "task";
    const sections = [
      {
        id: "mode-description",
        key: "description",
        order: 0,
        materializedMarkdown: "Choose this mode for review work.",
        materializedProposalId: "proposal-mode",
      },
      {
        id: "mode-files",
        key: "files",
        order: 1,
        materializedMarkdown: JSON.stringify({
          schemaVersion: "project-mode-files.v1",
          files: {
            "MODE.md": "Read this first.",
            "references/checklist.md": "Check the list.",
          },
        }),
        materializedProposalId: "proposal-mode",
      },
    ] as unknown as TaskResponseDto["sections"];
    mockHierarchyTask = createTask({
      type: "MODE",
      name: "Review discipline",
      sections,
    });
    mockWorkItemTask = mockHierarchyTask;
    mockWorkItemTypeDefinition = createDefinition({
      key: "MODE",
      name: "Review discipline",
      role: WorkItemTypeRole.ProjectInfo,
      sections: [
        { key: "description", label: "Catalog description" },
        {
          key: "files",
          label: "Files",
          kind: "json",
          schemaRef: "#/components/schemas/ProjectModeFiles",
        },
      ],
      agentGuidance: {
        overview: "A selectable project coding discipline.",
        contexts: [
          {
            focalTypeKeys: ["STANDARD"],
            guidance: "Use this mode for STANDARD work items.",
          },
        ],
      } as unknown as WorkItemTypeDefinitionDto["agentGuidance"],
      capabilities: { planEligible: false },
    });
    mockWorkItemTypes = [asSummary(mockWorkItemTypeDefinition)];

    renderTaskPage("/projects/project-1/initiatives/initiative-1/tasks/task-1");

    expect(mockWorkItemReadView).toHaveBeenCalledWith(
      expect.objectContaining({
        sections,
        sectionSelection: {
          status: "resolved",
          typeKey: "MODE",
          sections: mockWorkItemTypeDefinition.sections,
        },
      }),
    );
  });
});
