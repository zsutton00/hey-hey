import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import type {
  AgentSessionDto,
  GoalPmRoutingCreation,
  GoalPmRoutingSelectionPayload,
  GoalPmRoutingEnactmentResponse,
  LocalGoalPmConversationInventoryItem,
  ConversationResponseDto,
  ReportDto,
  TaskResponseDto,
  WorkItemTypeDefinitionDto,
  WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import {
  AgentEdgeType,
  AgentSessionType,
  EntityType,
  ReportType,
  TaskPriority,
  WorkItemTypeLifecycleStatus,
  WorkStatus,
  WorkflowName,
} from "@hey-hey/ui-common/api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GoalPmConversationLink } from "@hey-hey/ui-common/components";
import { GoalPage } from "./GoalPage";
import { createCanonicalPageDescriptor } from "@hey-hey/ui-common/context";

let mockConversationParam: string | null = null;
const mockSetConversationParam = vi.fn();
let mockIsPlatformAdmin = false;
let mockGoalTask: TaskResponseDto | null;
let mockGoalWorkItem: TaskResponseDto | null;
let mockTrackedWorkItems: Record<string, TaskResponseDto | null>;
let mockPlans: Record<string, { id: string; name: string; status: WorkStatus }>;
let mockDesignDocs: Record<
  string,
  { id: string; title: string; status: WorkStatus }
>;
let mockWorkItemTypes: WorkItemTypeSummaryDto[];
let mockReports: ReportDto[];
let mockGoalConversations: ConversationResponseDto[];
let mockGoalConversationSessions: AgentSessionDto[];
let mockGoalConversationsLoading: boolean;
let mockGoalConversationsError: Error | null;
let mockGoalLoading: boolean;
let mockTrackedTasksLoading: boolean;
const mockUpdateTask = vi.fn().mockResolvedValue(undefined);
const mockDetach = vi.fn().mockResolvedValue(undefined);
const mockAttach = vi.fn().mockResolvedValue(undefined);
const mockRefetchGoalWorkItem = vi.fn().mockResolvedValue(undefined);
const mockUseWorkItem = vi.fn();
const mockUseWorkItems = vi.fn();
const mockWorkItemMetadata = vi.fn();
const {
  mockEntityListItem,
  mockTaskAdapter,
  mockPlanAdapter,
  mockDesignDocAdapter,
  mockDetailPageContainer,
  mockGoalConversation,
  mockEnactChoice,
  mockCreateProposal,
  mockCreateConversation,
  mockRefreshConversations,
  mockDeleteConversation,
  mockSegmentedToggle,
  mockCapabilityCatalogState,
} = vi.hoisted(() => ({
  mockEntityListItem: vi.fn(),
  mockTaskAdapter: vi.fn(),
  mockPlanAdapter: vi.fn(),
  mockDesignDocAdapter: vi.fn(),
  mockDetailPageContainer: vi.fn(),
  mockSegmentedToggle: vi.fn(),
  mockGoalConversation: {
    launch: vi.fn(async () => true),
    createSession: vi.fn(async () => ({ id: "new-goal-session" })),
    request: undefined as ((text: string) => void) | undefined,
    handler: undefined as
      | ((draftText: string, creation?: GoalPmRoutingCreation) => Promise<void>)
      | undefined,
    link: undefined as GoalPmConversationLink | undefined,
  },
  mockEnactChoice: vi.fn(),
  mockCreateProposal: vi.fn(),
  mockCreateConversation: vi.fn(async () => ({})),
  mockRefreshConversations: vi.fn(),
  mockDeleteConversation: vi.fn(),
  mockCapabilityCatalogState: { status: "ready" as const, catalog: [] },
}));

vi.mock("nuqs", async () => {
  const { useCallback, useState } = await import("react");
  const useConversationParam = (): [
    string | null,
    (value: string | null) => Promise<void>,
  ] => {
    const [value, setValue] = useState(mockConversationParam);
    const setParam = useCallback(async (next: string | null) => {
      mockConversationParam = next;
      mockSetConversationParam(next);
      setValue(next);
    }, []);
    return [value, setParam];
  };
  return {
    parseAsString: {},
    useQueryState: () => useConversationParam(),
  };
});

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  activateCapabilityCatalogMachine: vi.fn(),
  Card: ({
    title,
    action,
    children,
    dataTestId = "card",
  }: {
    title: string;
    action?: React.ReactNode;
    children: React.ReactNode;
    dataTestId?: string;
  }) => (
    <section data-testid={dataTestId} aria-label={title}>
      <h2>{title}</h2>
      {action}
      {children}
    </section>
  ),
  bindGraphConversationAgentSessionMachine: vi.fn(async () => ({
    id: "new-goal-session",
  })),
  buildDefaultSurfaceSelection: () => ({
    provider: "claude",
    model: "claude-opus-4-7",
    reasoningEffort: "medium",
  }),
  getCapabilityCatalogLoadState: () => mockCapabilityCatalogState,
  buildEntityConversationSessionConfig: (selection: {
    model: string;
    reasoningEffort: string | null;
  }) => ({
    type: "ENTITY_CONVERSATION",
    version: "v1",
    model: selection.model,
    ...(selection.reasoningEffort ? { effort: selection.reasoningEffort } : {}),
  }),
  DISCUSS_SURFACE_ID: "discuss",
  getGoalConversationSurfaceId: (goalId: string) =>
    `goal-conversation:${goalId}`,
  resolveAgentBridgeRecoveryState: () => ({
    type: "ready",
    machine: {
      machineId: "machine-1",
      name: "Local CLI",
      executionReadiness: "READY",
    },
  }),
  ReportCard: ({ report }: { report: ReportDto }) => (
    <div data-testid={`report-card-${report.id}`} />
  ),
  NewConversationConfirmationDialog: ({
    open,
    onClose,
    onConfirm,
  }: {
    open: boolean;
    onClose: () => void;
    onConfirm: () => void;
  }) =>
    open ? (
      <div data-testid="new-conversation-confirmation-dialog">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" onClick={onConfirm}>
          Start new conversation
        </button>
      </div>
    ) : null,
  readSurfaceSelection: () => null,
  subscribeCapabilityCatalog: () => () => {},
  useMachineResolution: () => ({
    machines: [],
    executionReadyMachines: [],
    isReady: true,
    mode: "one",
    selectedMachine: { machineId: "machine-1" },
    setSelectedMachineId: vi.fn(),
  }),
  writeSurfaceSelection: vi.fn(),
  useEntityConversationLauncher: () => ({
    launch: mockGoalConversation.launch,
    isLoading: false,
    error: null,
    clearError: vi.fn(),
  }),
  EntityListItem: (props: Record<string, unknown>) => {
    mockEntityListItem(props);
    return (
      <div data-testid={`entity-list-item-${String(props.title)}`}>
        {typeof props.entityKindIcon === "string" && (
          <span
            data-testid="entity-kind-icon"
            data-icon-type={props.entityKindIcon}
            aria-label={
              typeof props.entityKindLabel === "string"
                ? props.entityKindLabel
                : props.entityKindIcon
            }
          />
        )}
      </div>
    );
  },
  InteractionComponent: ({
    children,
    contextualActions = [],
    entityId,
  }: {
    children: React.ReactNode;
    contextualActions?: Array<{
      testId?: string;
      onSelect: () => void;
    }>;
    entityId: string;
  }) => (
    <div data-testid={`goal-tracked-interaction-${entityId}`}>
      {children}
      {contextualActions.map((action) => (
        <button
          key={action.testId}
          type="button"
          data-testid={action.testId}
          onClick={action.onSelect}
        >
          Remove from goal
        </button>
      ))}
    </div>
  ),
  designDocAdapter: {
    toEntityListItemProps: mockDesignDocAdapter,
  },
  planAdapter: {
    toEntityListItemProps: mockPlanAdapter,
  },
  taskAdapter: {
    toEntityListItemProps: mockTaskAdapter,
  },
  formatStatus: (status: string) =>
    status
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^\w/, (character) => character.toUpperCase()),
  WorkItemMetadata: (props: {
    fields: {
      status?: { onChange?: (value: WorkStatus) => void };
      dueDate?: {
        onChange?: (value: string | null) => void;
        allowClear?: boolean;
      };
    };
  }) => {
    mockWorkItemMetadata(props);
    return (
      <div data-testid="goal-editable-metadata">
        <button
          type="button"
          data-testid="goal-status-selector"
          onClick={() => props.fields.status?.onChange?.(WorkStatus.Active)}
        >
          Status
        </button>
        <button
          type="button"
          data-testid="goal-due-date-selector"
          onClick={() =>
            props.fields.dueDate?.onChange?.(new Date(2026, 6, 4).toISOString())
          }
        >
          Due date
        </button>
        <button
          type="button"
          data-testid="due-date-clear"
          onClick={() => props.fields.dueDate?.onChange?.(null)}
        >
          Clear due date
        </button>
      </div>
    );
  },
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  createCanonicalPageDescriptor: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: () => ({
    isPlatformAdmin: mockIsPlatformAdmin,
    isResolved: true,
  }),
  isPlanWorkItem: (item: TaskResponseDto) => item.type === "PLAN",
  useAgentSessions: () => ({
    agentSessions: mockGoalConversationSessions,
    markStale: vi.fn(),
  }),
  useConversations: () => ({
    data: mockGoalConversations,
    markStale: mockRefreshConversations,
    isLoading: mockGoalConversationsLoading,
    isReady: !mockGoalConversationsLoading && !mockGoalConversationsError,
    error: mockGoalConversationsError,
  }),
  useDeleteConversation: () => ({
    mutate: mockDeleteConversation,
    isPending: false,
  }),
  useCreateAgentSessionConversation: () => ({ mutate: mockCreateConversation }),
  useCreateAgentSession: () => ({
    mutate: mockGoalConversation.createSession,
  }),
  useProject: () => ({
    data: { id: "project-1", name: "Project" },
  }),
  useTaskHierarchy: () => ({
    task: mockGoalTask,
    isLoading: mockGoalLoading,
    error: null,
  }),
  useReports: () => ({
    reports: mockReports,
  }),
  useDesignDoc: (_organizationId: string, entityId: string | undefined) => ({
    data: entityId ? (mockDesignDocs[entityId] ?? null) : null,
  }),
  usePlan: (_organizationId: string, _projectId: string, entityId: string) => ({
    data: mockPlans[entityId] ?? null,
  }),
  useWorkItem: (...args: unknown[]) => {
    mockUseWorkItem(...args);
    const entityId = typeof args[2] === "string" ? args[2] : "";
    return {
      workItem:
        entityId === "goal-task-1"
          ? mockGoalWorkItem
          : (mockTrackedWorkItems[entityId] ?? null),
      refetch: mockRefetchGoalWorkItem,
    };
  },
  useWorkItems: (...args: unknown[]) => {
    mockUseWorkItems(...args);
    return {
      workItems: Object.values(mockTrackedWorkItems).filter(Boolean),
      isLoading: mockTrackedTasksLoading,
    };
  },
  useWorkItemTypes: () => ({
    workItemTypes: mockWorkItemTypes,
    isFetched: true,
  }),
  useWorkItemTypeByKey: () => ({ workItemTypeSummary: undefined }),
  useWorkItemUpdateMethods: () => ({
    updateTask: mockUpdateTask,
  }),
  useDetachFromGoal: () => ({ detach: mockDetach }),
  useAttachToGoal: () => ({ attach: mockAttach }),
  useGoalPmRoutingEnactment: () => ({ mutate: mockEnactChoice }),
  useUserPairedMachines: () => ({
    machines: [{ machineId: "machine-1", active: true }],
  }),
}));

vi.mock("@hey-hey/ui-common/clients", () => ({
  proposalsClient: { createProposal: mockCreateProposal },
}));

vi.mock("../../components/SegmentedToggle", () => ({
  SegmentedToggle: (props: {
    mobileDropdown?: boolean;
    onChange: (value: string) => void;
    segments: readonly { value: string; label: string }[];
    value: string;
  }) => {
    mockSegmentedToggle(props);
    const isCompact = window.matchMedia("(max-width: 899px)").matches;

    if (props.mobileDropdown && isCompact) {
      return (
        <label>
          Goal view
          <select
            aria-label="Goal view"
            onChange={(event) => props.onChange(event.target.value)}
            value={props.value}
          >
            {props.segments.map((segment) => (
              <option key={segment.value} value={segment.value}>
                {segment.label}
              </option>
            ))}
          </select>
        </label>
      );
    }

    return (
      <div data-testid="goal-segmented-toggle">
        {props.segments.map((segment) => (
          <button
            key={segment.value}
            type="button"
            onClick={() => props.onChange(segment.value)}
          >
            {segment.label}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({
    currentOrgId: "org-1",
    userId: "user-1",
  }),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  getPathService: () => ({
    task: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
    designDoc: ({ designDocId }: { designDocId: string }) =>
      `/design-docs/${designDocId}`,
    plan: ({ planId }: { planId: string }) => `/plans/${planId}`,
  }),
  WebPathService: {
    task: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
    goal: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
    designDoc: ({ designDocId }: { designDocId: string }) =>
      `/design-docs/${designDocId}`,
    plan: ({ planId }: { planId: string }) => `/plans/${planId}`,
    service: ({ serviceId }: { serviceId: string }) => `/services/${serviceId}`,
    initiativeDetail: ({ initiativeId }: { initiativeId: string }) =>
      `/initiatives/${initiativeId}`,
    conversation: ({ conversationId }: { conversationId: string }) =>
      `/conversations/${conversationId}`,
  },
}));

vi.mock("@hey-hey/ui-common/utils", () => ({
  deriveGoalStatus: () => null,
  goalStatusChipDescriptor: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: () => null,
  DetailPageBody: ({
    content,
    sidebar,
    contextualRail,
  }: {
    content: React.ReactNode;
    sidebar: React.ReactNode;
    contextualRail?: { expanded: boolean };
  }) => (
    <div data-testid="detail-page-body">
      {content}
      {(!contextualRail || contextualRail.expanded) && sidebar}
    </div>
  ),
  DetailPageHeader: ({
    title,
    metadataComponent,
  }: {
    title: React.ReactNode;
    metadataComponent?: React.ReactNode;
  }) => (
    <div data-testid="detail-page-header">
      <div data-testid="detail-page-header-title">{title}</div>
      <div data-testid="detail-page-header-metadata">{metadataComponent}</div>
    </div>
  ),
  DetailPageContainer: ({
    children,
    paperSx,
  }: {
    children: React.ReactNode;
    paperSx?: Record<string, unknown>;
  }) => {
    mockDetailPageContainer({ paperSx });
    return (
      <div data-testid="detail-page-container">
        <div
          data-testid="detail-page-container-paper"
          style={paperSx as React.CSSProperties}
        >
          {children}
        </div>
      </div>
    );
  },
}));

vi.mock("../../components/Tabs/DataDebugTab", () => ({
  DataDebugTab: ({
    organizationId,
    projectId,
    entityId,
    entityType,
  }: {
    organizationId: string;
    projectId: string;
    entityId: string;
    entityType: string;
  }) => (
    <div
      data-testid="goal-data-debug-tab"
      data-organization-id={organizationId}
      data-project-id={projectId}
      data-entity-id={entityId}
      data-entity-type={entityType}
    />
  ),
}));

vi.mock("../../components/Conversation", () => ({
  GoalPrimaryConversation: (props: {
    organizationId: string;
    projectId: string;
    goalId: string;
    goalTask: TaskResponseDto;
    onCreateNewConversation?: (draftText: string) => Promise<void>;
    onGoalPmAction?: (
      action: GoalPmRoutingSelectionPayload,
      sourceConversationId: string,
      draftText?: string,
      creation?: GoalPmRoutingCreation,
    ) => Promise<GoalPmRoutingEnactmentResponse>;
    onGoalPmRequestSubmitted?: (text: string) => void;
    initialUserMessage?: string;
    selectedAgentSessionId?: string | null;
    initialDraft?: string;
    goalPm?: {
      conversationInventory: LocalGoalPmConversationInventoryItem[];
    };
    goalPmConversationLink?: GoalPmConversationLink;
  }) => <GoalPrimaryConversationMock {...props} />,
}));

const GoalPrimaryConversationMock: React.FC<{
  organizationId: string;
  projectId: string;
  goalId: string;
  goalTask: TaskResponseDto;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  onGoalPmAction?: (
    action: GoalPmRoutingSelectionPayload,
    sourceConversationId: string,
    draftText?: string,
    creation?: GoalPmRoutingCreation,
  ) => Promise<GoalPmRoutingEnactmentResponse>;
  onGoalPmRequestSubmitted?: (text: string) => void;
  initialUserMessage?: string;
  selectedAgentSessionId?: string | null;
  initialDraft?: string;
  goalPm?: {
    conversationInventory: LocalGoalPmConversationInventoryItem[];
  };
  goalPmConversationLink?: GoalPmConversationLink;
}> = (props) => {
  mockGoalConversation.request = props.onGoalPmRequestSubmitted;
  mockGoalConversation.link = props.goalPmConversationLink;
  mockGoalConversation.handler = async (text, creation) => {
    await props.onGoalPmAction?.(
      {
        sourceMessageId: "routing-message",
        uiElementId: "routing",
        selectedOptionId: "new-thread",
      },
      "goal-pm-conversation",
      text,
      creation,
    );
  };
  const scrollOwnerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const scrollOwner = scrollOwnerRef.current;
    if (!scrollOwner) return;

    const newestContentHeight =
      props.goalTask.name === "Updated Goal" ? 2200 : 1600;
    Object.defineProperty(scrollOwner, "scrollHeight", {
      configurable: true,
      value: newestContentHeight,
    });
    scrollOwner.scrollTop = newestContentHeight;
  }, [props.goalTask]);

  return (
    <div
      data-testid="goal-primary-conversation"
      data-goal-id={props.goalId}
      data-goal-description={
        props.goalTask.sections?.find(
          (section) => section.key === "description",
        )?.materializedMarkdown ?? ""
      }
      data-confirm-before-new-conversation="true"
      data-has-new-conversation-handler={String(
        Boolean(props.onCreateNewConversation),
      )}
      data-selected-session-id={props.selectedAgentSessionId ?? ""}
      data-initial-draft={props.initialDraft ?? ""}
      data-initial-message={props.initialUserMessage ?? ""}
      data-goal-pm-inventory={JSON.stringify(
        props.goalPm?.conversationInventory ?? [],
      )}
    >
      <div
        ref={scrollOwnerRef}
        data-testid="goal-conversation-scroll-owner"
        style={{ height: 320, overflowY: "auto" }}
      >
        <div data-testid="wide-inline-content" style={{ width: 2400 }} />
      </div>
    </div>
  );
};

vi.mock("../../utils/routeTransitions", () => ({
  tabTransitionVariants: {},
}));

const createGoalTask = (
  overrides: Partial<TaskResponseDto> = {},
): TaskResponseDto =>
  ({
    id: "goal-task-1",
    name: "My Goal",
    type: WORK_ITEM_TYPE_KEYS.Goal,
    organizationId: "org-1",
    projectId: "project-1",
    status: WorkStatus.Backlog,
    priority: TaskPriority.Low,
    sections: [],
    trackedEntities: [],
    serviceRelations: [],
    childCounts: { total: 0 },
    designDocCount: 0,
    codingSessionCount: 0,
    agentSessionCount: 0,
    ...overrides,
  }) as TaskResponseDto;

const createGoalConversation = (
  id: string,
  title: string,
  updatedAt: string,
): ConversationResponseDto =>
  ({
    id,
    title,
    projectId: "project-1",
    organizationId: "org-1",
    createdAt: updatedAt,
    updatedAt,
    messages: [],
    workflowName: WorkflowName.EntityConversation,
    createdBy: "user-1",
  }) as ConversationResponseDto;

const createGoalConversationSession = (
  id: string,
  conversationId: string,
): AgentSessionDto =>
  ({
    id,
    organizationId: "org-1",
    projectId: "project-1",
    conversationId,
    machineId: "machine-1",
    entityType: EntityType.Task,
    entityId: "goal-task-1",
    type: AgentSessionType.EntityConversation,
    title: "Goal conversation",
  }) as AgentSessionDto;

const createGoalReport = (overrides: Partial<ReportDto> = {}): ReportDto =>
  ({
    id: "goal-report-1",
    organizationId: "org-1",
    projectId: "project-1",
    reportType: ReportType.GoalProgress,
    title: "Goal progress",
    payload: { reportType: "GOAL_PROGRESS", summary: "Progress summary" },
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "execution-1",
    createdAt: "2026-07-22T19:00:00.000Z",
    expiresAt: "2027-07-22T19:00:00.000Z",
    entities: [],
    ...overrides,
  }) as ReportDto;

const createTypeDefinition = (
  key: string,
  name: string,
  allowedStatuses: WorkStatus[],
): WorkItemTypeDefinitionDto =>
  ({
    key,
    name,
    sections: [],
    allowedStatuses,
  }) as WorkItemTypeDefinitionDto;

const createTypeSummary = (
  definition: WorkItemTypeDefinitionDto,
  isSystem = true,
): WorkItemTypeSummaryDto => ({
  definition,
  isSystem,
  status: WorkItemTypeLifecycleStatus.Active,
  projectId: isSystem ? null : "project-1",
});

const findEntityListItemProps = (
  title: string,
): Record<string, unknown> | undefined =>
  mockEntityListItem.mock.calls
    .map(([props]) => props as Record<string, unknown>)
    .find((props) => props.title === title);

const goalPageRoute = (): React.ReactElement => (
  <MemoryRouter initialEntries={["/projects/project-1/tasks/goal-task-1"]}>
    <Routes>
      <Route path="/projects/:projectId/tasks/:taskId" element={<GoalPage />} />
    </Routes>
  </MemoryRouter>
);

const setViewportMatch = (matches: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const renderGoalPage = () => {
  return render(goalPageRoute());
};

describe("GoalPage tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnactChoice.mockResolvedValue({
      answer: {
        state: "COMPLETED",
        selectedOption: { kind: "startNewConversation" },
        outcome: {
          entityType: "CONVERSATION",
          entityId: "created-conversation",
          agentSessionId: "new-goal-session",
        },
      },
    });
    setViewportMatch(false);
    mockGoalConversation.handler = undefined;
    mockSegmentedToggle.mockClear();
    localStorage.clear();
    mockUpdateTask.mockResolvedValue(undefined);
    mockDetach.mockResolvedValue(undefined);
    mockConversationParam = null;
    mockIsPlatformAdmin = false;
    mockGoalTask = createGoalTask();
    mockGoalWorkItem = null;
    mockTrackedWorkItems = {};
    mockPlans = {};
    mockDesignDocs = {};
    mockWorkItemTypes = [];
    mockReports = [];
    mockGoalConversations = [];
    mockDeleteConversation.mockResolvedValue(undefined);
    mockGoalConversationSessions = [];
    mockGoalConversationsLoading = false;
    mockGoalConversationsError = null;
    mockGoalLoading = false;
    mockTrackedTasksLoading = false;
    mockRefetchGoalWorkItem.mockClear();
    mockTaskAdapter.mockImplementation(
      (
        task: TaskResponseDto,
        options: {
          pathService: { task: (input: { taskId: string }) => string };
          showEntityKind?: boolean;
          workItemTypeDefinition?: WorkItemTypeDefinitionDto;
        },
      ) => ({
        title: task.name,
        status: task.status,
        entityKindLabel: options.showEntityKind
          ? options.workItemTypeDefinition?.name
          : undefined,
        entityKindIcon: options.showEntityKind
          ? task.type === WORK_ITEM_TYPE_KEYS.Feature
            ? "feature"
            : "task"
          : undefined,
        href: options.pathService.task({ taskId: task.id }),
      }),
    );
    mockPlanAdapter.mockImplementation(
      (
        plan: { id: string; name: string; status: WorkStatus },
        options: {
          pathService: { plan: (input: { planId: string }) => string };
          showEntityKind?: boolean;
        },
      ) => ({
        title: plan.name,
        status: plan.status,
        entityKindLabel: options.showEntityKind ? "Plan" : undefined,
        entityKindIcon: options.showEntityKind ? "plan" : undefined,
        href: options.pathService.plan({ planId: plan.id }),
      }),
    );
    mockDesignDocAdapter.mockImplementation(
      (
        designDoc: { id: string; title: string; status: WorkStatus },
        options: {
          pathService: {
            designDoc: (input: { designDocId: string }) => string;
          };
          showEntityKind?: boolean;
        },
      ) => ({
        title: designDoc.title,
        status: designDoc.status,
        entityKindLabel: options.showEntityKind ? "Design doc" : undefined,
        entityKindIcon: options.showEntityKind ? "design_doc" : undefined,
        href: options.pathService.designDoc({ designDocId: designDoc.id }),
      }),
    );
  });

  it("keeps the responsive Conversations destination without an outer tab bar for ordinary users", async () => {
    renderGoalPage();

    await waitFor(() => {
      expect(screen.queryByTestId("detail-page-tabs")).not.toBeInTheDocument();
      expect(screen.getByTestId("goal-segmented-toggle")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Conversations" }),
      ).toBeInTheDocument();
    });
  });

  it("adds a Data Debug subtab for admins without an outer tab bar", async () => {
    mockIsPlatformAdmin = true;

    renderGoalPage();

    await waitFor(() => {
      expect(screen.queryByTestId("detail-page-tabs")).not.toBeInTheDocument();
      expect(
        within(screen.getByTestId("goal-segmented-toggle")).getByRole(
          "button",
          { name: "Data Debug" },
        ),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Data Debug" }));

    await waitFor(() => {
      const tab = screen.getByTestId("goal-data-debug-tab");
      expect(tab).toHaveAttribute("data-organization-id", "org-1");
      expect(tab).toHaveAttribute("data-project-id", "project-1");
      expect(tab).toHaveAttribute("data-entity-id", "goal-task-1");
      expect(tab).toHaveAttribute("data-entity-type", EntityType.Task);
      expect(
        screen.queryByTestId("goal-primary-conversation"),
      ).not.toBeInTheDocument();
    });
  });

  it("hides the Data Debug subtab from ordinary users", async () => {
    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("goal-segmented-toggle")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "Data Debug" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-data-debug-tab")).not.toBeInTheDocument();
  });

  it("creates a canonical child from the selected Goal PM action", async () => {
    renderGoalPage();

    await waitFor(() => {
      expect(mockGoalConversation.handler).toBeDefined();
    });
    act(() => mockGoalConversation.request?.("Discuss the launch"));
    await act(async () => {
      await mockGoalConversation.handler?.("carry this draft forward");
    });

    expect(mockEnactChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        goalId: "goal-task-1",
        sourceConversationId: "goal-pm-conversation",
        input: expect.objectContaining({
          selection: {
            sourceMessageId: "routing-message",
            uiElementId: "routing",
            selectedOptionId: "new-thread",
          },
          pendingRequest: "Discuss the launch",
          creation: expect.objectContaining({
            provider: "claude",
            config: {
              type: "ENTITY_CONVERSATION",
              version: "v1",
              model: "claude-opus-4-7",
              effort: "medium",
            },
          }),
        }),
      }),
    );
    expect(mockGoalConversation.createSession).not.toHaveBeenCalled();
    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
      "data-initial-message",
      "",
    );
    expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
      "data-selected-session-id",
      "new-goal-session",
    );
    expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
      "data-initial-draft",
      "carry this draft forward",
    );
    expect(mockSetConversationParam).toHaveBeenCalledWith(
      "created-conversation",
    );
    expect(mockGoalConversation.launch).not.toHaveBeenCalled();
  });

  it("launches the routed Goal conversation with the runtime chosen on the card", async () => {
    renderGoalPage();
    const cardCreation: GoalPmRoutingCreation = {
      config: {
        type: "ENTITY_CONVERSATION",
        version: "v1",
        model: "card-model",
        effort: "high",
      },
      provider: "codex",
      machineId: "card-machine",
      fastMode: true,
    };

    await waitFor(() => {
      expect(mockGoalConversation.handler).toBeDefined();
    });
    await act(async () => {
      await mockGoalConversation.handler?.("draft", cardCreation);
    });

    expect(mockEnactChoice).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ creation: cardCreation }),
      }),
    );
  });

  it("surfaces a failed routed Goal conversation creation", async () => {
    mockEnactChoice.mockRejectedValueOnce(
      new Error("Unable to create the Goal conversation."),
    );

    renderGoalPage();

    await waitFor(() => {
      expect(mockGoalConversation.handler).toBeDefined();
    });
    let thrownError: unknown;
    await act(async () => {
      try {
        await mockGoalConversation.handler?.("try again");
      } catch (error) {
        thrownError = error;
      }
    });
    expect(thrownError).toEqual(
      new Error("Unable to create the Goal conversation."),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("goal-new-conversation-error"),
      ).toHaveTextContent("Unable to create the Goal conversation.");
    });
  });

  it("renders the goal overview content on the default Goal tab", async () => {
    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("goal-compact-header")).toBeInTheDocument();
      expect(screen.getByTestId("goal-right-rail")).toBeInTheDocument();
      expect(screen.getByTestId("goal-conversation-toc")).toBeInTheDocument();
      expect(
        screen
          .getByTestId("goal-conversation-viewer")
          .compareDocumentPosition(screen.getByTestId("goal-right-rail")),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
        "data-has-new-conversation-handler",
        "false",
      );
    });
  });

  it("does not launch Goal PM from a failed conversation inventory", async () => {
    mockGoalConversationsError = new Error(
      "Conversation inventory unavailable",
    );

    renderGoalPage();

    expect(
      await screen.findByTestId("goal-conversation-inventory-error"),
    ).toHaveTextContent(
      "Goal conversations could not be loaded. Goal PM routing is unavailable.",
    );
    expect(
      screen.queryByTestId("goal-primary-conversation"),
    ).not.toBeInTheDocument();
  });

  it("selects canonical conversations through their session without submitting a turn", async () => {
    mockGoalConversations = [
      createGoalConversation(
        "conversation-new",
        "Current launch thread",
        "2026-09-03T12:00:00.000Z",
      ),
      createGoalConversation(
        "conversation-old",
        "Earlier launch thread",
        "2026-09-01T12:00:00.000Z",
      ),
    ];
    mockGoalConversations[0].workflowName = WorkflowName.GoalPm;
    mockGoalConversationSessions = [
      createGoalConversationSession("session-new", "conversation-new"),
      createGoalConversationSession("session-old", "conversation-old"),
    ];

    renderGoalPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("goal-conversation-toc-row-conversation-new"),
      ).toHaveAttribute("aria-current", "true");
      expect(
        JSON.parse(
          screen
            .getByTestId("goal-primary-conversation")
            .getAttribute("data-goal-pm-inventory") ?? "[]",
        ),
      ).toEqual([
        {
          conversationId: "conversation-new",
          title: "Current launch thread",
          owner: {
            entityType: EntityType.Task,
            entityId: "goal-task-1",
            taskType: "GOAL",
          },
          workflowName: WorkflowName.GoalPm,
        },
        {
          conversationId: "conversation-old",
          title: "Earlier launch thread",
          owner: {
            entityType: EntityType.Task,
            entityId: "goal-task-1",
            taskType: "GOAL",
          },
          workflowName: WorkflowName.EntityConversation,
        },
      ]);
    });

    fireEvent.click(
      screen.getByTestId("goal-conversation-toc-row-conversation-old"),
    );

    await waitFor(() => {
      expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
        "data-selected-session-id",
        "session-old",
      );
      expect(
        screen.getByTestId("goal-conversation-toc-row-conversation-old"),
      ).toHaveAttribute("aria-current", "true");
    });
    expect(mockSetConversationParam).toHaveBeenCalledWith("conversation-old");
    expect(mockGoalConversation.launch).not.toHaveBeenCalled();
    expect(mockGoalConversation.createSession).not.toHaveBeenCalled();
  });

  it("links Goal PM answers to the created conversation and opens it", async () => {
    mockGoalConversations = [
      createGoalConversation(
        "conversation-pm",
        "Goal PM",
        "2026-09-03T12:00:00.000Z",
      ),
      createGoalConversation(
        "conversation-created",
        "Created thread",
        "2026-09-04T12:00:00.000Z",
      ),
    ];
    mockGoalConversations[0].workflowName = WorkflowName.GoalPm;
    mockGoalConversationSessions = [
      createGoalConversationSession("session-pm", "conversation-pm"),
      createGoalConversationSession("session-created", "conversation-created"),
    ];

    renderGoalPage();

    await waitFor(() => expect(mockGoalConversation.link).toBeDefined());
    expect(mockGoalConversation.link!.href("conversation-created")).toBe(
      "/tasks/goal-task-1?conversation=conversation-created",
    );
    act(() => mockGoalConversation.link!.onOpen("conversation-created"));

    await waitFor(() =>
      expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
        "data-selected-session-id",
        "session-created",
      ),
    );
  });

  it("does not expose a TOC creation entry", () => {
    renderGoalPage();
    expect(
      screen.queryByTestId("goal-conversation-toc-new"),
    ).not.toBeInTheDocument();
    expect(mockGoalConversation.createSession).not.toHaveBeenCalled();
  });

  it("soft archives an active child, refreshes goal conversations, and returns to Goal PM", async () => {
    const goalPmConversation = createGoalConversation(
      "goal-pm",
      "Goal PM Conversation",
      "2026-09-04T12:00:00.000Z",
    );
    goalPmConversation.workflowName = WorkflowName.GoalPm;
    const childConversation = createGoalConversation(
      "goal-child",
      "Launch planning",
      "2026-09-03T12:00:00.000Z",
    );
    mockGoalConversations = [goalPmConversation, childConversation];
    mockGoalConversationSessions = [
      createGoalConversationSession("goal-pm-session", "goal-pm"),
      createGoalConversationSession("goal-child-session", "goal-child"),
    ];

    renderGoalPage();

    fireEvent.click(
      await screen.findByTestId("goal-conversation-toc-row-goal-child"),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("goal-conversation-toc-row-goal-child"),
      ).toHaveAttribute("aria-current", "true"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Archive Launch planning" }),
    );
    expect(
      screen.getByTestId("goal-conversation-toc-row-goal-child"),
    ).toHaveAttribute("aria-current", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Archive", exact: true }),
    );

    await waitFor(() =>
      expect(mockDeleteConversation).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "project-1",
        conversationId: "goal-child",
        deleteRequest: { hardDelete: false },
      }),
    );
    await waitFor(() => {
      expect(mockRefreshConversations).toHaveBeenCalled();
      expect(
        screen.getByTestId("goal-conversation-toc-row-goal-pm"),
      ).toHaveAttribute("aria-current", "true");
      expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
        "data-selected-session-id",
        "goal-pm-session",
      );
    });
    expect(mockSetConversationParam).toHaveBeenLastCalledWith(null);
  });

  describe("conversation URL parameter", () => {
    const seedGoalConversations = (): void => {
      const goalPmConversation = createGoalConversation(
        "goal-pm",
        "Goal PM Conversation",
        "2026-09-04T12:00:00.000Z",
      );
      goalPmConversation.workflowName = WorkflowName.GoalPm;
      mockGoalConversations = [
        goalPmConversation,
        createGoalConversation(
          "goal-child",
          "Launch planning",
          "2026-09-03T12:00:00.000Z",
        ),
      ];
      mockGoalConversationSessions = [
        createGoalConversationSession("goal-pm-session", "goal-pm"),
        createGoalConversationSession("goal-child-session", "goal-child"),
      ];
    };

    it("opens the conversation named in the URL without replaying a request", async () => {
      seedGoalConversations();
      mockConversationParam = "goal-child";

      renderGoalPage();

      await waitFor(() =>
        expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
          "data-selected-session-id",
          "goal-child-session",
        ),
      );
      expect(
        screen.getByTestId("goal-conversation-toc-row-goal-child"),
      ).toHaveAttribute("aria-current", "true");
      expect(mockSetConversationParam).not.toHaveBeenCalled();
      expect(mockEnactChoice).not.toHaveBeenCalled();
      expect(mockGoalConversation.launch).not.toHaveBeenCalled();
    });

    it("opens Goal PM when no conversation is in the URL", async () => {
      seedGoalConversations();

      renderGoalPage();

      await waitFor(() =>
        expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
          "data-selected-session-id",
          "goal-pm-session",
        ),
      );
      expect(mockSetConversationParam).not.toHaveBeenCalled();
    });

    it("clears an unknown conversation and falls back to Goal PM", async () => {
      seedGoalConversations();
      mockConversationParam = "not-this-goals-conversation";

      renderGoalPage();

      await waitFor(() =>
        expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
          "data-selected-session-id",
          "goal-pm-session",
        ),
      );
      expect(mockSetConversationParam).toHaveBeenCalledWith(null);
    });

    it("does not carry the conversation to another goal", async () => {
      seedGoalConversations();
      mockConversationParam = "goal-child";
      let navigateTo: ((path: string) => void) | undefined;
      const NavigateProbe = (): null => {
        navigateTo = useNavigate();
        return null;
      };

      render(
        <MemoryRouter
          initialEntries={["/projects/project-1/tasks/goal-task-1"]}
        >
          <NavigateProbe />
          <Routes>
            <Route
              path="/projects/:projectId/tasks/:taskId"
              element={<GoalPage />}
            />
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
          "data-selected-session-id",
          "goal-child-session",
        ),
      );
      expect(mockSetConversationParam).not.toHaveBeenCalled();

      act(() => navigateTo?.("/projects/project-1/tasks/goal-task-2"));

      await waitFor(() =>
        expect(mockSetConversationParam).toHaveBeenCalledWith(null),
      );
    });
  });

  it("partitions the GoalPage into Overview, Conversations, and Tracked Items", async () => {
    mockReports = [createGoalReport()];
    mockGoalTask = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "tracked-task-1",
          targetEntityType: EntityType.Task,
          title: "Tracked task",
          status: WorkStatus.Active,
        },
      ],
    });
    mockTrackedWorkItems["tracked-task-1"] = createGoalTask({
      id: "tracked-task-1",
      name: "Tracked task",
      type: WORK_ITEM_TYPE_KEYS.Standard,
      status: WorkStatus.Active,
    });

    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("goal-segmented-toggle")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Overview" }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("goal-segmented-toggle")).getByRole(
          "button",
          {
            name: "Conversations",
          },
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Tracked Items" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("goal-detail-grid")).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-primary-conversation"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("goal-tracked-entities")).toBeInTheDocument();
    });

    expect(mockSegmentedToggle).toHaveBeenCalledWith(
      expect.objectContaining({
        mobileDropdown: true,
        value: "overview",
        segments: [
          { value: "overview", label: "Overview" },
          { value: "conversations", label: "Conversations" },
          { value: "tracked-items", label: "Tracked Items" },
        ],
      }),
    );

    fireEvent.click(
      within(screen.getByTestId("goal-segmented-toggle")).getByRole("button", {
        name: "Conversations",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("goal-conversation-view")).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-primary-conversation"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("goal-conversation-toc")).toBeInTheDocument();
      expect(
        screen
          .getByTestId("goal-conversation-viewer")
          .compareDocumentPosition(screen.getByTestId("goal-conversation-toc")),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(
        screen.queryByTestId("goal-tracked-entities"),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tracked Items" }));

    await waitFor(() => {
      expect(screen.getByTestId("goal-tracked-items-view")).toBeInTheDocument();
      expect(screen.getByTestId("goal-latest-report")).toBeInTheDocument();
      expect(screen.getByTestId("goal-tracked-entities")).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-tracked-entity-tracked-task-1"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("goal-primary-conversation"),
      ).not.toBeInTheDocument();
    });
  });

  it("uses the shared destination dropdown on compact layouts", async () => {
    setViewportMatch(true);

    renderGoalPage();

    await waitFor(() => {
      expect(
        screen.getByRole("combobox", { name: "Goal view" }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(3);
    });

    expect(mockSegmentedToggle).toHaveBeenCalledWith(
      expect.objectContaining({ mobileDropdown: true, value: "overview" }),
    );
  });

  it("renders the description after status and due date as a single-line control with full-value access", async () => {
    mockGoalWorkItem = createGoalTask({
      sections: [
        {
          id: "goal-description",
          key: "description",
          order: 0,
          materializedMarkdown: "Coordinate the launch across teams.",
          crdtSnapshotSeq: null,
        },
      ],
    });

    renderGoalPage();

    const control = await screen.findByTestId("goal-description-edit");
    const text = screen.getByTestId("goal-description-text");
    const row = screen.getByTestId("goal-metadata-row");
    const description = screen.getByTestId("goal-description");

    expect(
      within(row).getByTestId("goal-editable-metadata"),
    ).toBeInTheDocument();
    expect(within(row).getByTestId("goal-description")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("goal-due-date-selector")
        .compareDocumentPosition(control),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(text).toHaveTextContent("Coordinate the launch across teams.");
    expect(text).toHaveStyle({
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    expect(control).toHaveAttribute(
      "title",
      "Coordinate the launch across teams.",
    );
    expect(description).toHaveStyle({
      maxWidth: "300px",
      alignSelf: "flex-start",
    });
    expect(control.firstElementChild).toHaveStyle({ padding: "10px" });
    expect(
      screen.queryByTestId("goal-description-toggle"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-description-paper"),
    ).not.toBeInTheDocument();
  });

  it("shows an actionable empty state and disables description editing in preview", async () => {
    const { unmount } = renderGoalPage();
    const emptyControl = await screen.findByTestId("goal-description-edit");

    expect(emptyControl).toBeEnabled();
    expect(emptyControl).toHaveTextContent("No description provided.");
    expect(emptyControl).toHaveAttribute("title", "No description provided.");

    unmount();
    render(
      <MemoryRouter>
        <GoalPage
          organizationId="organization-1"
          projectId="project-1"
          taskId="goal-task-1"
          preview
        />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("goal-description-edit")).toBeDisabled();
  });

  it("opens with the persisted draft and keeps save errors inline", async () => {
    const description = "Coordinate the launch across teams.";
    mockGoalWorkItem = createGoalTask({
      sections: [
        {
          id: "goal-description",
          key: "description",
          order: 0,
          materializedMarkdown: description,
          crdtSnapshotSeq: null,
        },
      ],
    });
    mockUpdateTask.mockRejectedValueOnce(
      new Error("Description could not be saved."),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderGoalPage();
    fireEvent.click(await screen.findByTestId("goal-description-edit"));
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      description,
    );
    fireEvent.click(screen.getByTestId("goal-description-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Description could not be saved.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it("edits the description through the goal update boundary and refreshes conversation context", async () => {
    const initialDescription = "Coordinate the launch across teams.";
    const updatedDescription = "Align launch messaging with support.";
    mockGoalWorkItem = createGoalTask({
      sections: [
        {
          id: "goal-description",
          key: "description",
          order: 0,
          materializedMarkdown: initialDescription,
          crdtSnapshotSeq: null,
        },
      ],
    });
    mockUpdateTask.mockImplementationOnce(async (_taskId, updates) => {
      const content = updates.sections?.find(
        (section) => section.key === "description",
      )?.content;
      mockGoalWorkItem = createGoalTask({
        sections: [
          {
            id: "goal-description",
            key: "description",
            order: 0,
            materializedMarkdown: String(content),
            crdtSnapshotSeq: null,
          },
        ],
      });
      return mockGoalWorkItem;
    });

    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("goal-description-edit")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("goal-description-edit"));

    const input = screen.getByRole("textbox", { name: "Description" });
    expect(input).toHaveValue(initialDescription);
    fireEvent.change(input, { target: { value: updatedDescription } });
    fireEvent.click(screen.getByTestId("goal-description-save"));

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith("goal-task-1", {
        sections: [
          {
            key: "description",
            content: updatedDescription,
            order: 0,
          },
        ],
      });
      expect(mockRefetchGoalWorkItem).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("goal-description-text")).toHaveTextContent(
        updatedDescription,
      );
      expect(screen.getByTestId("goal-primary-conversation")).toHaveAttribute(
        "data-goal-description",
        updatedDescription,
      );
    });
  });

  it("publishes the loaded goal label in canonical presentation", () => {
    mockGoalWorkItem = createGoalTask({ name: "Ship adoption" });

    renderGoalPage();

    expect(vi.mocked(createCanonicalPageDescriptor)).toHaveBeenCalledWith(
      "goal",
      "goal-task-1",
      null,
      { kind: "goal", label: "Ship adoption" },
    );
  });

  it("renders the goal's primary conversation thread in the left column", async () => {
    renderGoalPage();

    await waitFor(() => {
      const conversation = screen.getByTestId("goal-primary-conversation");
      expect(conversation).toBeInTheDocument();
      expect(conversation).toHaveAttribute("data-goal-id", "goal-task-1");
    });
  });

  it("keeps the goal detail visible while tracked-task data is loading", () => {
    mockTrackedTasksLoading = true;
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "tracked-task-1",
          targetEntityType: EntityType.Task,
          title: "Tracked task",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    expect(screen.getByTestId("goal-conversation-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("goal-primary-conversation")).toBeInTheDocument();
    expect(
      screen.getByTestId("goal-tracked-entities-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-tracked-task-1"),
    ).not.toBeInTheDocument();
  });

  it("shows the dated latest report before tracked work in the right rail", async () => {
    const report = createGoalReport();
    mockReports = [report];

    renderGoalPage();

    await waitFor(() => {
      const reportContainer = screen.getByTestId("goal-latest-report");
      const trackedWork = screen.getByTestId("goal-tracked-entities");
      expect(
        screen.getByRole("heading", { name: "Latest progress report" }),
      ).toBeVisible();
      expect(
        screen.getByRole("heading", { name: "Tracked work" }),
      ).toBeVisible();
      expect(reportContainer.compareDocumentPosition(trackedWork)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(
        screen
          .getByTestId("goal-right-rail")
          .querySelector('[data-testid="goal-latest-report"]'),
      ).not.toBeNull();
      expect(screen.getByTestId("goal-latest-report-date")).toHaveTextContent(
        new Date(report.createdAt).toLocaleDateString(),
      );
      expect(
        screen.getByTestId("report-card-goal-report-1"),
      ).toBeInTheDocument();
    });
  });

  it("renders tracked work in the right rail", async () => {
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "feature-1",
          targetEntityType: EntityType.Task,
          title: "Tracked feature",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("goal-tracked-entities")).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-tracked-entity-feature-1"),
      ).toBeInTheDocument();
    });
  });

  it("removes a tracked task through the goal-scoped action and refreshes tracked work", async () => {
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "standard-1",
          targetEntityType: EntityType.Task,
          title: "Tracked task",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("goal-tracked-interaction-standard-1"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("goal-tracked-remove-from-goal"));

    await waitFor(() => {
      expect(mockDetach).toHaveBeenCalledWith({
        goalId: "goal-task-1",
        targetEntityId: "standard-1",
        targetEntityType: EntityType.Task,
      });
      expect(mockRefetchGoalWorkItem).toHaveBeenCalledTimes(1);
    });
  });

  it("removes a tracked plan through the goal-scoped action", async () => {
    mockTrackedWorkItems["plan-1"] = createGoalTask({
      id: "plan-1",
      name: "Delivery plan",
      type: "PLAN",
      status: WorkStatus.Active,
    });
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "plan-1",
          targetEntityType: EntityType.Task,
          title: "Delivery plan",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("goal-tracked-interaction-plan-1"),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("goal-tracked-remove-from-goal"));

    await waitFor(() => {
      expect(mockDetach).toHaveBeenCalledWith({
        goalId: "goal-task-1",
        targetEntityId: "plan-1",
        targetEntityType: EntityType.Task,
      });
      expect(mockRefetchGoalWorkItem).toHaveBeenCalledTimes(1);
    });
  });

  it("filters tracked work by represented statuses with OR matching and hides all rows when cleared", async () => {
    const standardDefinition = createTypeDefinition(
      WORK_ITEM_TYPE_KEYS.Standard,
      "Task",
      [WorkStatus.Backlog, WorkStatus.Active, WorkStatus.Ready],
    );
    const featureDefinition = createTypeDefinition(
      WORK_ITEM_TYPE_KEYS.Feature,
      "Feature",
      [],
    );
    mockWorkItemTypes = [
      createTypeSummary(standardDefinition),
      createTypeSummary(featureDefinition),
    ];
    mockTrackedWorkItems["active-1"] = createGoalTask({
      id: "active-1",
      name: "Active task",
      type: WORK_ITEM_TYPE_KEYS.Standard,
      status: WorkStatus.Active,
      edges: [
        {
          id: "edge-1",
          sourceNodeId: "active-1",
          sourceEntityType: EntityType.Task,
          sourceNodeName: "Active task",
          targetNodeId: "dependency-1",
          targetEntityType: EntityType.Task,
          targetNodeName: "Dependency",
          type: AgentEdgeType.DependsOn,
          reasoning: "Required first",
        },
      ],
    });
    mockTrackedWorkItems["backlog-1"] = createGoalTask({
      id: "backlog-1",
      name: "Backlog task",
      type: WORK_ITEM_TYPE_KEYS.Standard,
      status: WorkStatus.Backlog,
    });
    mockTrackedWorkItems["ready-1"] = createGoalTask({
      id: "ready-1",
      name: "Ready task",
      type: WORK_ITEM_TYPE_KEYS.Standard,
      status: WorkStatus.Ready,
    });
    mockTrackedWorkItems["feature-1"] = createGoalTask({
      id: "feature-1",
      name: "Statusless feature",
      type: WORK_ITEM_TYPE_KEYS.Feature,
      status: WorkStatus.Active,
    });
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "active-1",
          targetEntityType: EntityType.Task,
          title: "Active task",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "backlog-1",
          targetEntityType: EntityType.Task,
          title: "Backlog task",
          status: WorkStatus.Backlog,
        },
        {
          targetEntityId: "ready-1",
          targetEntityType: EntityType.Task,
          title: "Ready task",
          status: WorkStatus.Ready,
        },
        {
          targetEntityId: "feature-1",
          targetEntityType: EntityType.Task,
          title: "Statusless feature",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("goal-tracked-status-filter"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-tracked-entity-active-1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-tracked-entity-backlog-1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-tracked-entity-ready-1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-tracked-entity-feature-1"),
      ).toBeInTheDocument();
    });

    const toggleStatus = (status: string) => {
      fireEvent.mouseDown(
        screen.getByRole("combobox", { name: "Filter by status" }),
      );
      fireEvent.click(screen.getByRole("option", { name: status }));
      fireEvent.keyDown(screen.getByRole("listbox"), {
        key: "Escape",
        code: "Escape",
      });
    };

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Filter by status" }),
    );
    for (const status of ["Active", "Backlog", "Ready"]) {
      expect(
        within(screen.getByRole("option", { name: status })).getByRole(
          "checkbox",
        ),
      ).toBeChecked();
    }
    fireEvent.keyDown(screen.getByRole("listbox"), {
      key: "Escape",
      code: "Escape",
    });

    toggleStatus("Active");
    expect(
      screen.queryByTestId("goal-tracked-entity-active-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("goal-tracked-entity-backlog-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("goal-tracked-entity-ready-1"),
    ).toBeInTheDocument();

    toggleStatus("Backlog");
    expect(
      screen.queryByTestId("goal-tracked-entity-active-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-backlog-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("goal-tracked-entity-ready-1"),
    ).toBeInTheDocument();

    toggleStatus("Ready");
    expect(
      screen.queryByTestId("goal-tracked-entity-active-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-backlog-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-ready-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-feature-1"),
    ).not.toBeInTheDocument();

    toggleStatus("Active");
    expect(
      screen.getByTestId("goal-tracked-entity-active-1"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-backlog-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-ready-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-feature-1"),
    ).not.toBeInTheDocument();

    toggleStatus("Backlog");
    expect(
      screen.getByTestId("goal-tracked-entity-active-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("goal-tracked-entity-backlog-1"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-ready-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-feature-1"),
    ).not.toBeInTheDocument();
    expect(findEntityListItemProps("Active task")).toMatchObject({
      href: "/tasks/active-1",
      dependencies: [
        expect.objectContaining({
          edgeType: AgentEdgeType.DependsOn,
          targetTitle: "Dependency",
        }),
      ],
    });

    toggleStatus("Active");
    expect(
      screen.queryByTestId("goal-tracked-entity-active-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("goal-tracked-entity-backlog-1"),
    ).toBeInTheDocument();

    toggleStatus("Backlog");
    expect(
      screen.queryByTestId("goal-tracked-entity-active-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-backlog-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-ready-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("goal-tracked-entity-feature-1"),
    ).not.toBeInTheDocument();
  });

  it("restores and persists the tracked status selection per goal", async () => {
    const standardDefinition = createTypeDefinition(
      WORK_ITEM_TYPE_KEYS.Standard,
      "Task",
      [WorkStatus.Backlog, WorkStatus.Active],
    );
    mockWorkItemTypes = [createTypeSummary(standardDefinition)];
    mockTrackedWorkItems["active-1"] = createGoalTask({
      id: "active-1",
      name: "Active task",
      type: WORK_ITEM_TYPE_KEYS.Standard,
      status: WorkStatus.Active,
    });
    mockTrackedWorkItems["backlog-1"] = createGoalTask({
      id: "backlog-1",
      name: "Backlog task",
      type: WORK_ITEM_TYPE_KEYS.Standard,
      status: WorkStatus.Backlog,
    });
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "active-1",
          targetEntityType: EntityType.Task,
          title: "Active task",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "backlog-1",
          targetEntityType: EntityType.Task,
          title: "Backlog task",
          status: WorkStatus.Backlog,
        },
      ],
    });

    const storageKey = "goal-tracked-status-filter:v1:project-1:goal-task-1";
    localStorage.setItem(storageKey, JSON.stringify([WorkStatus.Active]));

    const rendered = renderGoalPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("goal-tracked-entity-active-1"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("goal-tracked-entity-backlog-1"),
      ).not.toBeInTheDocument();
    });

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Filter by status" }),
    );
    fireEvent.click(screen.getByRole("option", { name: "Backlog" }));
    fireEvent.keyDown(screen.getByRole("listbox"), {
      key: "Escape",
      code: "Escape",
    });

    expect(JSON.parse(localStorage.getItem(storageKey) ?? "null")).toEqual([
      WorkStatus.Active,
      WorkStatus.Backlog,
    ]);
    expect(
      screen.getByTestId("goal-tracked-entity-backlog-1"),
    ).toBeInTheDocument();

    rendered.unmount();
    renderGoalPage();

    await waitFor(() => {
      expect(
        screen.getByTestId("goal-tracked-entity-active-1"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("goal-tracked-entity-backlog-1"),
      ).toBeInTheDocument();
    });
  });

  it("renders a resolved standard task with its registry kind, status, href, and dependencies", async () => {
    const standardDefinition = createTypeDefinition(
      WORK_ITEM_TYPE_KEYS.Standard,
      "Task",
      [WorkStatus.Backlog, WorkStatus.Active],
    );
    mockWorkItemTypes = [createTypeSummary(standardDefinition)];
    mockTrackedWorkItems["standard-1"] = createGoalTask({
      id: "standard-1",
      name: "Implement tracked work",
      type: WORK_ITEM_TYPE_KEYS.Standard,
      status: WorkStatus.Active,
      edges: [
        {
          id: "edge-1",
          sourceNodeId: "standard-1",
          sourceEntityType: EntityType.Task,
          sourceNodeName: "Implement tracked work",
          targetNodeId: "dependency-1",
          targetEntityType: EntityType.Task,
          targetNodeName: "Required dependency",
          type: AgentEdgeType.DependsOn,
          reasoning: "Required first",
        },
      ],
    });
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "standard-1",
          targetEntityType: EntityType.Task,
          title: "Implement tracked work",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      const props = findEntityListItemProps("Implement tracked work");
      expect(props).toMatchObject({
        entityKindLabel: "Task",
        entityKindIcon: "task",
        status: WorkStatus.Active,
        href: "/tasks/standard-1",
        dependencies: [
          {
            edgeType: AgentEdgeType.DependsOn,
            direction: "outgoing",
            targetTitle: "Required dependency",
            href: "/tasks/dependency-1",
          },
        ],
      });
    });

    expect(mockTaskAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ id: "standard-1" }),
      expect.objectContaining({
        showEntityKind: true,
        workItemTypeDefinition: standardDefinition,
      }),
    );
  });

  it("hydrates de-duplicated tracked tasks once with incident edges", async () => {
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "standard-1",
          targetEntityType: EntityType.Task,
          title: "First reference",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "standard-1",
          targetEntityType: EntityType.Task,
          title: "Second reference",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "plan-1",
          targetEntityType: EntityType.Task,
          title: "Plan reference",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      expect(mockUseWorkItems).toHaveBeenCalledWith(
        "org-1",
        "task",
        "project-1",
        undefined,
        expect.objectContaining({
          taskIds: ["standard-1", "plan-1"],
          includeEdges: true,
          enabled: true,
        }),
      );
    });
    expect(mockUseWorkItems).toHaveBeenCalledTimes(1);
    expect(
      mockUseWorkItem.mock.calls
        .filter((call) => call[3]?.enabled !== false)
        .map((call) => call[2]),
    ).toEqual(["goal-task-1"]);
    expect(mockUseWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "goal-task-1",
      expect.any(Object),
    );
  });

  it("uses registry names for feature and custom work items and only shows owned statuses", async () => {
    const featureDefinition = createTypeDefinition(
      WORK_ITEM_TYPE_KEYS.Feature,
      "Feature",
      [],
    );
    const campaignDefinition = createTypeDefinition("CAMPAIGN", "Campaign", [
      WorkStatus.Backlog,
      WorkStatus.Active,
    ]);
    mockWorkItemTypes = [
      createTypeSummary(featureDefinition),
      createTypeSummary(campaignDefinition, false),
    ];
    mockTrackedWorkItems["feature-1"] = createGoalTask({
      id: "feature-1",
      name: "Tracked feature",
      type: WORK_ITEM_TYPE_KEYS.Feature,
      status: WorkStatus.Active,
    });
    mockTrackedWorkItems["campaign-1"] = createGoalTask({
      id: "campaign-1",
      name: "Launch campaign",
      type: "CAMPAIGN",
      status: WorkStatus.Active,
    });
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "feature-1",
          targetEntityType: EntityType.Task,
          title: "Tracked feature",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "campaign-1",
          targetEntityType: EntityType.Task,
          title: "Launch campaign",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      expect(findEntityListItemProps("Tracked feature")).toMatchObject({
        entityKindLabel: "Feature",
        entityKindIcon: "feature",
        status: undefined,
      });
      expect(findEntityListItemProps("Launch campaign")).toMatchObject({
        entityKindLabel: "Campaign",
        entityKindIcon: "task",
        status: WorkStatus.Active,
      });
      expect(screen.getAllByTestId("entity-kind-icon")).toHaveLength(2);
      expect(screen.getByLabelText("Feature")).toHaveAttribute(
        "data-icon-type",
        "feature",
      );
      expect(screen.getByLabelText("Campaign")).toHaveAttribute(
        "data-icon-type",
        "task",
      );
    });
  });

  it("uses canonical kinds for every supported non-work-item row", async () => {
    mockTrackedWorkItems["plan-1"] = createGoalTask({
      id: "plan-1",
      name: "Delivery plan",
      type: "PLAN",
      status: WorkStatus.Active,
    });
    mockDesignDocs["design-doc-1"] = {
      id: "design-doc-1",
      title: "Interaction design",
      status: WorkStatus.Active,
    };
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "plan-1",
          targetEntityType: EntityType.Task,
          title: "Delivery plan",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "design-doc-1",
          targetEntityType: EntityType.DesignDoc,
          title: "Interaction design",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "service-1",
          targetEntityType: EntityType.Service,
          title: "UI",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "initiative-1",
          targetEntityType: EntityType.Initiative,
          title: "Goals rollout",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "conversation-1",
          targetEntityType: EntityType.Conversation,
          title: "Goal discussion",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      expect(findEntityListItemProps("Delivery plan")).toMatchObject({
        entityKindLabel: "Plan",
        entityKindIcon: "plan",
        href: "/plans/plan-1",
      });
      expect(findEntityListItemProps("Interaction design")).toMatchObject({
        entityKindLabel: "Design doc",
        entityKindIcon: "design_doc",
        href: "/design-docs/design-doc-1",
      });
      expect(findEntityListItemProps("UI")).toMatchObject({
        entityKindLabel: "Service",
        entityKindIcon: "service",
        href: "/services/service-1",
      });
      expect(findEntityListItemProps("Goals rollout")).toMatchObject({
        entityKindLabel: "Initiative",
        entityKindIcon: "initiative",
        href: "/initiatives/initiative-1",
      });
      expect(findEntityListItemProps("Goal discussion")).toMatchObject({
        entityKindLabel: "Conversation",
        entityKindIcon: "conversation",
        href: "/conversations/conversation-1",
      });
    });
  });

  it("shows canonical fallback kinds while suppressing unresolved task status", async () => {
    mockGoalWorkItem = createGoalTask({
      trackedEntities: [
        {
          targetEntityId: "loading-task-1",
          targetEntityType: EntityType.Task,
          title: "Loading task",
          status: WorkStatus.Active,
        },
        {
          targetEntityId: "report-1",
          targetEntityType: EntityType.Report,
          title: "Fallback item",
          status: WorkStatus.Active,
        },
      ],
    });

    renderGoalPage();

    await waitFor(() => {
      expect(findEntityListItemProps("Loading task")).toMatchObject({
        entityKindLabel: "Task",
        entityKindIcon: "task",
        status: undefined,
        href: "/tasks/loading-task-1",
      });
      expect(findEntityListItemProps("Fallback item")).toMatchObject({
        entityKindLabel: "Item",
        entityKindIcon: "design_doc",
        status: "Active",
      });
    });
  });

  it("renders editable goal status and due date controls", async () => {
    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("goal-editable-metadata")).toBeInTheDocument();
      expect(screen.getByTestId("goal-status-selector")).toBeInTheDocument();
      expect(screen.getByTestId("goal-due-date-selector")).toBeInTheDocument();
      expect(mockWorkItemMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: {
            status: expect.objectContaining({
              mode: "editable",
              value: WorkStatus.Backlog,
            }),
            dueDate: {
              mode: "editable",
              value: null,
              allowClear: true,
              onChange: expect.any(Function),
            },
          },
          disabled: false,
          taskType: WORK_ITEM_TYPE_KEYS.Goal,
        }),
      );
    });
  });

  it("updates the goal status and due date from the metadata controls", async () => {
    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("goal-status-selector")).toBeInTheDocument();
    });

    screen.getByTestId("goal-status-selector").click();
    screen.getByTestId("goal-due-date-selector").click();

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith("goal-task-1", {
        status: WorkStatus.Active,
      });
      expect(mockUpdateTask).toHaveBeenCalledWith("goal-task-1", {
        dueDate: new Date(2026, 6, 4).toISOString(),
      });
      expect(mockRefetchGoalWorkItem).toHaveBeenCalledTimes(1);
    });
  });

  it("clears the optional target date and refreshes the Goal", async () => {
    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("due-date-clear")).toBeInTheDocument();
    });

    screen.getByTestId("due-date-clear").click();

    await waitFor(() => {
      expect(mockUpdateTask).toHaveBeenCalledWith("goal-task-1", {
        dueDate: null,
      });
      expect(mockRefetchGoalWorkItem).toHaveBeenCalledOnce();
    });
  });

  it("maintains responsive grid layout (xs: 1fr, md: 1fr 1fr)", async () => {
    renderGoalPage();

    await waitFor(() => {
      const rightRail = screen.getByTestId("goal-right-rail");
      expect(rightRail).toBeInTheDocument();
    });
  });

  it("contains wide inline conversation content within the viewer column", async () => {
    renderGoalPage();

    await waitFor(() => {
      expect(screen.getByTestId("wide-inline-content")).toBeInTheDocument();
    });

    expect(screen.getByTestId("goal-right-rail")).toHaveStyle({
      minWidth: "0",
    });
    expect(screen.getByTestId("detail-page-container-paper")).toHaveStyle({
      minWidth: "0",
      minHeight: "0",
      overflow: "hidden",
    });
    expect(screen.getByTestId("goal-conversation-viewer")).toHaveStyle({
      minWidth: "0",
      minHeight: "0",
    });
    expect(screen.getByTestId("goal-conversation")).toHaveStyle({
      width: "100%",
    });
    expect(screen.getByTestId("goal-tracked-entities")).toBeInTheDocument();
  });

  it("keeps the complete right rail as one scroll owner", async () => {
    mockReports = [createGoalReport()];
    mockGoalConversations = Array.from({ length: 8 }, (_, index) =>
      createGoalConversation(
        `conversation-${index}`,
        `Goal conversation ${index}`,
        `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
      ),
    );
    const trackedTaskIds = Array.from(
      { length: 8 },
      (_, index) => `tracked-task-${index}`,
    );
    mockGoalTask = createGoalTask({
      trackedEntities: trackedTaskIds.map((id, index) => ({
        targetEntityId: id,
        targetEntityType: EntityType.Task,
        title: `Tracked task ${index}`,
        status: WorkStatus.Active,
      })),
    });
    mockTrackedWorkItems = Object.fromEntries(
      trackedTaskIds.map((id, index) => [
        id,
        createGoalTask({
          id,
          name: `Tracked task ${index}`,
          type: WORK_ITEM_TYPE_KEYS.Standard,
          status: WorkStatus.Active,
        }),
      ]),
    );

    renderGoalPage();

    const rightColumn = await waitFor(() =>
      screen.getByTestId("goal-right-rail"),
    );
    Object.defineProperty(rightColumn, "scrollHeight", {
      configurable: true,
      value: 2400,
    });
    rightColumn.scrollTop = 900;
    const conversationScrollport = screen.getByTestId(
      "goal-conversation-scroll-owner",
    );
    conversationScrollport.scrollTop = 1600;

    expect(rightColumn).toHaveStyle({
      minWidth: "0",
      minHeight: "0",
      overflowX: "hidden",
      overflowY: "auto",
    });
    expect(screen.getByTestId("goal-conversation-toc")).not.toHaveStyle({
      maxHeight: "50%",
    });
    expect(screen.getByTestId("goal-conversation-toc-scrollport")).toHaveStyle({
      overflowY: "visible",
    });
    expect(screen.getByTestId("goal-related-work")).toHaveStyle({
      overflowY: "visible",
    });
    expect(screen.getByTestId("goal-latest-report")).toBeInTheDocument();
    expect(screen.getByTestId("goal-tracked-entities")).toBeInTheDocument();
    expect(
      screen.getByTestId("goal-tracked-entity-tracked-task-0"),
    ).toBeInTheDocument();
    expect(rightColumn.scrollTop).toBe(900);
    expect(conversationScrollport.scrollTop).toBe(1600);

    conversationScrollport.scrollTop = 2200;
    expect(conversationScrollport.scrollTop).toBe(2200);
    expect(rightColumn.scrollTop).toBe(900);
  });

  it("keeps initial and subsequent conversation movement in its owned scrollport", async () => {
    const pageScrollport = document.createElement("main");
    pageScrollport.scrollTop = 180;
    const explorerScrollport = document.createElement("aside");
    explorerScrollport.scrollTop = 260;

    const rendered = renderGoalPage();
    const conversationScrollport = await waitFor(() =>
      screen.getByTestId("goal-conversation-scroll-owner"),
    );

    expect(conversationScrollport.scrollTop).toBe(1600);
    expect(pageScrollport.scrollTop).toBe(180);
    expect(explorerScrollport.scrollTop).toBe(260);

    mockGoalTask = createGoalTask({ name: "Updated Goal" });
    rendered.rerender(goalPageRoute());

    await waitFor(() => {
      expect(conversationScrollport.scrollTop).toBe(2200);
    });
    expect(pageScrollport.scrollTop).toBe(180);
    expect(explorerScrollport.scrollTop).toBe(260);
  });
});
