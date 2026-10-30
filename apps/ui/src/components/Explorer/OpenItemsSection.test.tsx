import {
  installOpenItemsTestRuntime,
  openItemsTestUserId,
  readOpenItemsTestCache,
} from "../../test/openItemsTestRuntime";
import { OpenItemsProvider } from "../../contexts/OpenItemsContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createEntityActivation } from "@hey-hey/ui-common/context";
import {
  AgentSessionCurrentState,
  AgentSessionOutputAttentionState,
  AgentSessionType,
  ConversationPhase,
  EntityType,
  TargetEntityType,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  useAgentSession,
  useAgentSessionCurrentStates,
  useAgentSessionOutputAttentions,
  useConversationPhases,
  useConversation,
  useDesignDoc,
  usePlan,
  useService,
  useWorkItem,
  useOpenItemGoalWork,
  useWorkItemTypes,
  useEntityStars,
} from "@hey-hey/ui-common/data";
import {
  act,
  fireEvent,
  render as renderWithoutClient,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const render: typeof renderWithoutClient = (ui, options) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithoutClient(ui, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
};
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isActiveAgentSessionForOpenItems,
  OpenItemsSection,
} from "./OpenItemsSection";
import { projectOpenItems } from "./openItemsProjection";
import { useOpenItems } from "../../contexts/OpenItemsContext";
import { buildAgentSessionNavigationLineage } from "../../pages/AgentSession/agentic/agentSessionNavigationLineage";
import { buildPlanStepNavigationLineage } from "../../pages/Plan/planStepNavigationLineage";
import { buildTaskNavigationLineage } from "../../pages/Task/taskNavigationLineage";

const {
  canHoverMock,
  currentCanonicalPageMock,
  compactInteractionMock,
  entityDragSourceMock,
  entityHoverCardMock,
  entityHoverCardUnmountMock,
  entityIconMock,
  openItemInteractionMock,
  openPreviewMock,
  getEntityColorsMock,
  resolveWorkItemIconPresentationMock,
  resolvedIconComponent,
} = vi.hoisted(() => ({
  canHoverMock: vi.fn(() => true),
  currentCanonicalPageMock: vi.fn(),
  compactInteractionMock: vi.fn(() => false),
  entityDragSourceMock: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
  })),
  entityHoverCardMock: vi.fn(),
  entityHoverCardUnmountMock: vi.fn(),
  entityIconMock: vi.fn(),
  openItemInteractionMock: vi.fn(),
  openPreviewMock: vi.fn(),
  getEntityColorsMock: vi.fn(),
  resolveWorkItemIconPresentationMock: vi.fn(),
  resolvedIconComponent: () => null,
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useCanHover: canHoverMock,
}));

vi.mock("@hey-hey/ui-common/components/Entity", () => ({
  EntityIcon: (props: {
    agentSessionType?: string;
    entityType: string;
    size?: number;
  }) => {
    entityIconMock(props);
    return (
      <span
        data-agent-session-type={props.agentSessionType ?? ""}
        data-testid={`entity-icon-${props.entityType}`}
      />
    );
  },
}));

vi.mock("@hey-hey/ui-common/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/data")>()),
  useAgentSession: vi.fn(),
  useAgentSessionCurrentStates: vi.fn(),
  useAgentSessionOutputAttentions: vi.fn(),
  useConversationPhases: vi.fn(),
  useConversation: vi.fn(),
  useDesignDoc: vi.fn(),
  usePlan: vi.fn(),
  useService: vi.fn(),
  useWorkItem: vi.fn(),
  useOpenItemGoalWork: vi.fn(),
  useWorkItemTypes: vi.fn(),
  useEntityStars: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hey-hey/ui-common/components")>();

  return {
    getAgentSessionRowSignalPresentation:
      actual.getAgentSessionRowSignalPresentation,
    ConversationPhaseIndicator: ({ phase }: { phase: string | undefined }) =>
      phase ? (
        <span
          aria-label={phase}
          data-phase={phase}
          data-testid="conversation-phase-indicator"
        />
      ) : null,
    AgentSessionCurrentStateIndicator: ({
      currentState,
      presentation,
    }: {
      currentState: string | undefined;
      presentation: "animated" | "icon";
    }) =>
      currentState ? (
        <span
          aria-label={
            currentState === AgentSessionCurrentState.Thinking
              ? "Thinking"
              : currentState
          }
          data-current-state={currentState}
          data-presentation={presentation}
          data-testid="agent-session-current-state-indicator"
        />
      ) : null,
    AgentSessionOutputAttentionIndicator: ({
      state,
    }: {
      state: string | undefined;
    }) =>
      state === "MESSAGE_READY" ? (
        <span
          aria-label="New response"
          data-output-attention-state={state}
          data-testid="agent-session-output-attention-indicator"
        />
      ) : null,
  };
});

vi.mock("@hey-hey/ui-common/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/utils")>()),
  getEntityColors: getEntityColorsMock,
  resolveWorkItemIconPresentation: resolveWorkItemIconPresentationMock,
}));

vi.mock("@hey-hey/ui-common/context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hey-hey/ui-common/context")>();
  return {
    ...actual,
    useCurrentCanonicalPage: currentCanonicalPageMock,
    useTheme: () => ({ mode: "light", toggleMode: vi.fn() }),
    usePreviewHost: () => ({ openPreview: openPreviewMock }),
  };
});

vi.mock("@hey-hey/ui-common/components/InteractionComponent", () => ({
  useEntityDragSource: entityDragSourceMock,
  OpenItemInteractionComponent: ({
    children,
    entityId,
    entityType,
    entitySubtype,
    organizationId,
    projectId,
    draggable,
    selection,
    openItemGroupActions,
    openItemActions,
    onSelectItems,
    onContextMenuOpen,
    onContextMenuClose,
  }: {
    children: React.ReactNode;
    entityId: string;
    entityType: string;
    entitySubtype?: string;
    organizationId?: string;
    projectId?: string;
    draggable?: boolean;
    selection: import("@hey-hey/ui-common/components/InteractionComponent").OpenItemSelectionContext;
    openItemGroupActions: import("@hey-hey/ui-common/components/InteractionComponent").OpenItemGroupActions;
    openItemActions: {
      activeOnly: { enabled: boolean; onSelect: () => void };
      onRemoveFromOpen: () => void;
      removeOthers: { hasTargets: boolean; onSelect: () => void };
      removeAllAbove: { hasTargets: boolean; onSelect: () => void };
      removeAllBelow: { hasTargets: boolean; onSelect: () => void };
      removeAll: { hasTargets: boolean; onSelect: () => void };
      whyOpen: { kind: "add" | "edit"; onSelect: () => void };
      pin: { hasTargets: boolean; onSelect: () => void };
      unpin: { hasTargets: boolean; onSelect: () => void };
      sort: { direction: "oldest" | "newest"; onSelect: () => void };
    };
    onSelectItems?: () => void;
    onContextMenuOpen?: () => void;
    onContextMenuClose?: () => void;
  }) => {
    openItemInteractionMock({
      draggable,
      entityId,
      entitySubtype,
      entityType,
      organizationId,
      projectId,
    });
    if (compactInteractionMock()) {
      return (
        <div data-testid={`open-item-interaction-${entityId}`}>{children}</div>
      );
    }
    return (
      <div
        data-testid={`open-item-interaction-${entityId}`}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenuOpen?.();
        }}
        data-entity-id={entityId}
        data-entity-type={entityType}
        data-entity-subtype={entitySubtype ?? ""}
      >
        {children}
        <button onClick={onContextMenuClose} type="button">
          Close menu
        </button>
        <button onClick={onSelectItems} type="button">
          Select items
        </button>
        <button
          aria-pressed={openItemActions.activeOnly.enabled}
          onClick={openItemActions.activeOnly.onSelect}
          type="button"
        >
          Show active only
        </button>
        {openItemGroupActions.groups[0] ? (
          <button
            type="button"
            onClick={() =>
              openItemGroupActions.onAssign(
                openItemGroupActions.groups[0].id,
                selection.selectedIdentities,
                { entityId, entityType },
              )
            }
          >
            Assign existing group
          </button>
        ) : null}
        <button
          onClick={
            selection.selectedIdentities.length > 1
              ? () => selection.onRemoveSelected(selection.selectedIdentities)
              : openItemActions.onRemoveFromOpen
          }
          type="button"
        >
          {selection.selectedIdentities.length > 1
            ? "Remove items from Open"
            : "Remove from Open"}
        </button>
        <button
          disabled={!openItemActions.removeOthers.hasTargets}
          onClick={openItemActions.removeOthers.onSelect}
          type="button"
        >
          Remove Others
        </button>
        <button
          disabled={!openItemActions.removeAllAbove.hasTargets}
          onClick={openItemActions.removeAllAbove.onSelect}
          type="button"
        >
          Remove All Above
        </button>
        <button
          disabled={!openItemActions.removeAllBelow.hasTargets}
          onClick={openItemActions.removeAllBelow.onSelect}
          type="button"
        >
          Remove All Below
        </button>
        <button
          disabled={!openItemActions.removeAll.hasTargets}
          onClick={openItemActions.removeAll.onSelect}
          type="button"
        >
          Remove All
        </button>
        <button onClick={openItemActions.whyOpen.onSelect} type="button">
          {openItemActions.whyOpen.kind === "add" ? "Add note" : "Edit note"}
        </button>
        {openItemActions.pin.hasTargets ? (
          <button onClick={openItemActions.pin.onSelect} type="button">
            Pin
          </button>
        ) : null}
        {openItemActions.unpin.hasTargets ? (
          <button onClick={openItemActions.unpin.onSelect} type="button">
            Unpin
          </button>
        ) : null}
        <button onClick={openItemActions.sort.onSelect} type="button">
          Sort by {openItemActions.sort.direction}
        </button>
      </div>
    );
  },
}));

vi.mock("@hey-hey/ui-common/components/shared", () => ({
  EntityHoverCard: ({
    anchorEl,
    ...props
  }: {
    anchorEl: HTMLElement | null;
  }) => {
    entityHoverCardMock(props);
    React.useEffect(
      () => () => entityHoverCardUnmountMock(props.entityId),
      [props.entityId],
    );
    return (
      <div data-testid="entity-hover-card">
        {anchorEl ? "peek open" : "peek closed"}
      </div>
    );
  },
}));

vi.mock("@hey-hey/ui-common/services", () => ({
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
    goal: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      `/projects/${projectId}/tasks/${taskId}`,
    conversation: ({
      projectId,
      conversationId,
    }: {
      projectId: string;
      conversationId: string;
    }) => `/projects/${projectId}/conversations/${conversationId}`,
    entityConversation: ({
      projectId,
      agentSessionId,
      conversationId,
      entityId,
      entityType,
    }: {
      projectId: string;
      agentSessionId: string;
      conversationId: string;
      entityId: string;
      entityType: string;
    }) =>
      `/projects/${projectId}/agent-sessions/${agentSessionId}/entity-conversations/${conversationId}?entityId=${entityId}&entityType=${entityType}`,
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
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const useWorkItemMock = vi.mocked(useWorkItem);
const useAgentSessionMock = vi.mocked(useAgentSession);
const useAgentSessionCurrentStatesMock = vi.mocked(
  useAgentSessionCurrentStates,
);
const useAgentSessionOutputAttentionsMock = vi.mocked(
  useAgentSessionOutputAttentions,
);
const useConversationPhasesMock = vi.mocked(useConversationPhases);
const useConversationMock = vi.mocked(useConversation);
const useDesignDocMock = vi.mocked(useDesignDoc);
const usePlanMock = vi.mocked(usePlan);
const useServiceMock = vi.mocked(useService);
const useWorkItemTypesMock = vi.mocked(useWorkItemTypes);
let seededTaskType = "STANDARD";

const createWorkItemDefinition = (
  key: string,
  iconKey: string,
): WorkItemTypeDefinitionDto =>
  ({ key, name: key, iconKey }) as WorkItemTypeDefinitionDto;

const setWorkItemTypeDefinitions = (
  ...definitions: WorkItemTypeDefinitionDto[]
): void => {
  seededTaskType = definitions[0]?.key ?? "STANDARD";
  useWorkItemTypesMock.mockReturnValue({
    workItemTypes: definitions.map((definition) => ({ definition })),
  } as unknown as ReturnType<typeof useWorkItemTypes>);
};

const nativeSetItem = Storage.prototype.setItem;
let preserveMissingPresentation = false;
let openItemsApi: ReturnType<typeof installOpenItemsTestRuntime>;

const defaultPresentation = (
  entityType: string,
  entityId: string,
): Record<string, unknown> | undefined => {
  const labels: Record<string, string> = {
    "e8a970e8-3ee8-5d4f-a62e-d273e23779ab": "Investigate preview",
    "bbc04762-4810-53b6-a5a9-7075c179551f": "Task Two",
    "ca4dd2f6-d35b-5130-aa34-2e74840afbf7": "Task Three",
    "6df6c145-14e2-51bc-9baa-c2a33c906c05": "Task Four",
    "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e": "Ship the goal",
    "885f5380-2285-5451-af9f-d9a4a474d503": "Resolve launch blockers",
    "f60e4e1c-9801-514f-a431-e9e18905dae7": "Request retry policy",
    "8013eea4-4c54-5f6a-ae42-d9188e822bf7": "Ship the importer",
  };
  const label = labels[entityId] ?? entityId;
  switch (entityType) {
    case "task":
      return { kind: "task", label, taskType: seededTaskType };
    case "agent_session":
      return {
        kind: "agent_session",
        label,
        sessionType: AgentSessionType.Coding,
      };
    case "initiative":
    case "goal":
    case "conversation":
    case "design_doc":
    case "plan":
    case "proposal":
      return { kind: entityType, label };
    default:
      return undefined;
  }
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

const RouteActivationProbe = () => {
  const location = useLocation();
  const { activate } = useOpenItems();

  React.useEffect(() => {
    const match = location.pathname.match(/^\/projects\/[^/]+\/tasks\/([^/]+)/);
    if (match) {
      activate(
        createEntityActivation("task", match[1], null, {
          kind: "task",
          label: "Investigate preview",
          taskType: "STANDARD",
        }),
      );
    }
  }, [activate, location.pathname]);

  return null;
};

const ManualActivationControls = () => {
  const { activate } = useOpenItems();

  return (
    <button
      onClick={() =>
        activate(
          createEntityActivation(
            "task",
            "bbc04762-4810-53b6-a5a9-7075c179551f",
            null,
            {
              kind: "task",
              label: "Task Two",
              taskType: "STANDARD",
            },
          ),
        )
      }
      type="button"
    >
      Activate task 2
    </button>
  );
};

const SectionRerenderHarness = () => {
  const [renderCount, setRenderCount] = React.useState(0);
  return (
    <>
      <button
        onClick={() => setRenderCount((count) => count + 1)}
        type="button"
      >
        Rerender section parent
      </button>
      <span data-testid="section-parent-render-count">{renderCount}</span>
      <OpenItemsSection organizationId="org-1" projectId="project-1" />
    </>
  );
};

describe("OpenItemsSection", () => {
  beforeEach(() => {
    localStorage.clear();
    openItemsApi = installOpenItemsTestRuntime();
    vi.clearAllMocks();
    canHoverMock.mockReturnValue(true);
    vi.mocked(useOpenItemGoalWork).mockReturnValue({
      work: [],
      isLoading: false,
      error: null,
      retry: vi.fn(),
    });
    vi.mocked(useEntityStars).mockReturnValue({
      isStarred: () => false,
    } as ReturnType<typeof useEntityStars>);
    preserveMissingPresentation = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(
      function (key, value) {
        if (key.startsWith("open-items:v1:") && !preserveMissingPresentation) {
          const record = JSON.parse(value) as {
            items?: Array<Record<string, unknown>>;
          };
          if (Array.isArray(record.items)) {
            record.items = record.items.map((item) => ({
              ...item,
              ...(item.presentation === undefined &&
              typeof item.entityType === "string" &&
              typeof item.entityId === "string"
                ? {
                    presentation: defaultPresentation(
                      item.entityType,
                      item.entityId,
                    ),
                  }
                : {}),
            }));
            nativeSetItem.call(this, key, JSON.stringify(record));
            return;
          }
        }
        nativeSetItem.call(this, key, value);
      },
    );
    compactInteractionMock.mockReturnValue(false);
    entityHoverCardMock.mockReset();
    entityHoverCardUnmountMock.mockReset();
    openItemInteractionMock.mockReset();
    openPreviewMock.mockReset();
    getEntityColorsMock.mockReset();
    getEntityColorsMock.mockReturnValue({
      background: "action.hover",
      color: "text.secondary",
    });
    resolveWorkItemIconPresentationMock.mockImplementation(
      (
        taskType: string | undefined,
        definition: WorkItemTypeDefinitionDto | undefined,
      ) => {
        if (taskType === undefined) return undefined;
        if (definition?.key !== taskType || definition.iconKey === undefined) {
          return undefined;
        }
        return {
          Icon: resolvedIconComponent,
          colors: getEntityColorsMock(taskType),
        };
      },
    );
    setWorkItemTypeDefinitions();
    currentCanonicalPageMock.mockReturnValue(null);
    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: {
        id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        name: "Investigate preview",
      },
    } as unknown as ReturnType<typeof useWorkItem>);
    useAgentSessionMock.mockReturnValue({
      agentSession: null,
    } as unknown as ReturnType<typeof useAgentSession>);
    useAgentSessionCurrentStatesMock.mockReturnValue({
      currentStateById: {},
      isFetching: false,
    });
    useAgentSessionOutputAttentionsMock.mockReturnValue({});
    useConversationPhasesMock.mockReturnValue({});
    useConversationMock.mockReturnValue({ data: null } as ReturnType<
      typeof useConversation
    >);
    useDesignDocMock.mockReturnValue({
      data: null,
    } as unknown as ReturnType<typeof useDesignDoc>);
    usePlanMock.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof usePlan>);
    useServiceMock.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useService>);
  });

  afterEach(() => {
    vi.mocked(Storage.prototype.setItem).mockRestore();
  });

  const seedPromotionGroup = () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        groups: [
          {
            id: "550e8400-e29b-41d4-a716-446655440002",
            name: "Launch outcome",
            order: 0,
            collapsed: false,
          },
        ],
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            groupId: "550e8400-e29b-41d4-a716-446655440002",
            presentation: {
              kind: "task",
              label: "Ship launch",
              taskType: "STANDARD",
            },
          },
          {
            entityId: "f60e4e1c-9801-514f-a431-e9e18905dae7",
            entityType: "design_doc",
            groupId: "550e8400-e29b-41d4-a716-446655440002",
            presentation: { kind: "design_doc", label: "Launch notes" },
          },
        ],
      }),
    );
  };
  const promotionView = () => (
    <MemoryRouter initialEntries={["/current-page"]}>
      <OpenItemsProvider
        organizationId="org-1"
        projectId="project-1"
        userId={openItemsTestUserId()}
      >
        <OpenItemsSection organizationId="org-1" projectId="project-1" />
        <LocationProbe />
      </OpenItemsProvider>
    </MemoryRouter>
  );
  const openPromotion = async () => {
    fireEvent.contextMenu(await screen.findByTestId("open-items-group-header"));
    await userEvent.click(
      screen.getByTestId("open-items-group-context-promote"),
    );
  };

  it("confirms promotion with optional date and publishes a pinned Goal while retaining untracked members", async () => {
    seedPromotionGroup();
    render(promotionView());
    await openPromotion();
    expect(screen.getByLabelText("Goal name")).toHaveValue("Launch outcome");
    expect(screen.getByLabelText("Target date (optional)")).toHaveValue("");
    await userEvent.clear(screen.getByLabelText("Goal name"));
    await userEvent.type(
      screen.getByLabelText("Goal name"),
      "Ship the release",
    );
    fireEvent.change(screen.getByLabelText("Target date (optional)"), {
      target: { value: "2026-10-20" },
    });
    await userEvent.click(screen.getByTestId("open-items-promotion-confirm"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(openItemsApi.promoteGroupToGoal).toHaveBeenCalledWith(
      expect.objectContaining({
        promoteGroupToGoalRequest: {
          groupId: "550e8400-e29b-41d4-a716-446655440002",
          goalName: "Ship the release",
          targetDate: "2026-10-20T00:00:00.000Z",
          idempotencyKey: expect.any(String),
        },
      }),
    );
    const cached = readOpenItemsTestCache("project-1");
    expect(cached.groups).toEqual([]);
    expect(cached.items).toHaveLength(2);
    expect(
      cached.items.find((item) => item.entityType === "goal"),
    ).toMatchObject({
      pinned: true,
      presentation: { label: "Ship the release" },
    });
    expect(
      cached.items.find((item) => item.entityType === "design_doc")?.groupId,
    ).toBeUndefined();
    expect(useOpenItemGoalWork).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent("/current-page");
  });

  it("cancels without mutation and omits an optional date on confirmation", async () => {
    seedPromotionGroup();
    render(promotionView());
    await openPromotion();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(openItemsApi.promoteGroupToGoal).not.toHaveBeenCalled();
    await openPromotion();
    await userEvent.click(screen.getByTestId("open-items-promotion-confirm"));
    await waitFor(() =>
      expect(openItemsApi.promoteGroupToGoal).toHaveBeenCalledOnce(),
    );
    expect(
      vi.mocked(openItemsApi.promoteGroupToGoal).mock.calls[0][0]
        .promoteGroupToGoalRequest,
    ).not.toHaveProperty("targetDate");
  });

  it("requires refresh and explicit reconfirmation with the same retry identity after stale failure", async () => {
    seedPromotionGroup();
    vi.mocked(openItemsApi.promoteGroupToGoal).mockRejectedValueOnce(
      new AxiosError("Stale group", undefined, undefined, undefined, {
        status: 409,
      } as never),
    );
    render(promotionView());
    await openPromotion();
    await userEvent.click(screen.getByTestId("open-items-promotion-confirm"));
    expect(
      await screen.findByTestId("open-items-promotion-error"),
    ).toHaveTextContent("Refresh Open Items");
    expect(screen.getByTestId("open-items-promotion-confirm")).toBeDisabled();
    await userEvent.click(screen.getByTestId("open-items-promotion-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("open-items-promotion-confirm")).toBeEnabled(),
    );
    expect(openItemsApi.promoteGroupToGoal).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByTestId("open-items-promotion-confirm"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const calls = vi.mocked(openItemsApi.promoteGroupToGoal).mock.calls;
    expect(calls[1][0].promoteGroupToGoalRequest).toEqual(
      calls[0][0].promoteGroupToGoalRequest,
    );
  });

  it("retains retry identity for an explicitly reconfirmed partial provider failure", async () => {
    seedPromotionGroup();
    vi.mocked(openItemsApi.promoteGroupToGoal).mockRejectedValueOnce(
      new Error("Tracking failed"),
    );
    render(promotionView());
    await openPromotion();
    await userEvent.click(screen.getByTestId("open-items-promotion-confirm"));
    await screen.findByTestId("open-items-promotion-error");
    await userEvent.click(screen.getByTestId("open-items-promotion-refresh"));
    await waitFor(() =>
      expect(screen.getByTestId("open-items-promotion-confirm")).toBeEnabled(),
    );
    expect(openItemsApi.promoteGroupToGoal).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByTestId("open-items-promotion-confirm"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const calls = vi.mocked(openItemsApi.promoteGroupToGoal).mock.calls;
    expect(calls[1][0].promoteGroupToGoalRequest).toEqual(
      calls[0][0].promoteGroupToGoalRequest,
    );
  });

  it("loads tracked work only after authoritative expansion and saves the filter", async () => {
    seedPromotionGroup();
    render(promotionView());
    await openPromotion();
    await userEvent.click(screen.getByTestId("open-items-promotion-confirm"));
    const goal = await screen.findByRole("button", {
      name: "Expand Launch outcome",
    });
    expect(useOpenItemGoalWork).not.toHaveBeenCalled();
    await userEvent.click(goal);
    expect(
      await screen.findByTestId("open-item-goal-work-empty"),
    ).toHaveTextContent("No matching work");
    expect(useOpenItemGoalWork).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      expect.any(String),
      "ACTIVE_AND_BACKLOG",
    );
    expect(openItemsApi.setOpenItemGoalDisclosure).toHaveBeenCalledWith(
      expect.objectContaining({
        setOpenItemGoalDisclosureRequest: {
          idempotencyKey: expect.any(String),
          collapsed: false,
        },
      }),
    );
    await userEvent.click(
      screen.getByRole("combobox", { name: "Tracked work" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Active only" }));
    await waitFor(() =>
      expect(
        readOpenItemsTestCache("project-1").items.find(
          (item) => item.entityType === "goal",
        )?.goalTrackedWorkFilter,
      ).toBe("ACTIVE"),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Collapse Launch outcome" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("open-item-goal-work"),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps Goal loading and errors local and previews nested work without changing the page", async () => {
    seedPromotionGroup();
    const view = render(promotionView());
    await openPromotion();
    await userEvent.click(screen.getByTestId("open-items-promotion-confirm"));
    vi.mocked(useOpenItemGoalWork).mockReturnValue({
      work: [],
      isLoading: true,
      error: null,
      retry: vi.fn(),
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Expand Launch outcome" }),
    );
    expect(
      await screen.findByText("Loading tracked work…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Launch notes" }),
    ).toBeInTheDocument();
    const retry = vi.fn();
    vi.mocked(useOpenItemGoalWork).mockReturnValue({
      work: [],
      isLoading: false,
      error: new Error("Unavailable"),
      retry,
    });
    view.rerender(promotionView());
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    const entityId = "e8a970e8-3ee8-5d4f-a62e-d273e23779ab";
    currentCanonicalPageMock.mockReturnValue({ entityType: "task", entityId });
    vi.mocked(useOpenItemGoalWork).mockReturnValue({
      work: [
        {
          targetEntityType: EntityType.Task,
          targetEntityId: entityId,
          title: "Ship launch",
        },
      ],
      isLoading: false,
      error: null,
      retry,
    });
    view.rerender(promotionView());
    expect(screen.getByRole("link", { name: "Ship launch" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await userEvent.click(
      screen.getByTestId(`open-item-preview-task-${entityId}`),
    );
    expect(openPreviewMock).toHaveBeenCalledWith({
      entityType: "task",
      entityId,
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/current-page");
    expect(readOpenItemsTestCache("project-1").items).toHaveLength(2);
  });

  it("reflects organization-scoped stars without hydrating rows", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e01",
            entityType: "task",
          },
          {
            entityId: "3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e02",
            entityType: "goal",
          },
          {
            entityId: "3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e03",
            entityType: "plan",
          },
        ],
      }),
    );
    const isStarred = vi.fn(
      (_type: EntityType, id: string) =>
        id === "3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e02",
    );
    vi.mocked(useEntityStars).mockReturnValue({ isStarred } as ReturnType<
      typeof useEntityStars
    >);
    const section = (organizationId: string) => (
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection
            organizationId={organizationId}
            projectId="project-1"
          />
          <CanonicalOpenItemsReady />
        </OpenItemsProvider>
      </MemoryRouter>
    );
    const { rerender } = render(section("org-1"));
    const goalRow = await screen.findByTestId(
      "open-item-goal-3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e02",
    );
    const taskRow = () =>
      screen.getByTestId("open-item-task-3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e01");
    expect(
      within(goalRow).getByRole("img", { name: /^Starred / }),
    ).toBeInTheDocument();
    expect(
      within(taskRow()).queryByRole("img", { name: /^Starred / }),
    ).toBeNull();
    expect(isStarred).toHaveBeenCalledWith(
      EntityType.Task,
      "3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e02",
    );
    expect(isStarred).toHaveBeenCalledWith(
      EntityType.Task,
      "3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e03",
    );

    isStarred.mockImplementation(
      (_type, id) => id === "3c6f2b1e-6d0a-5b8e-9f3d-1a2b3c4d5e01",
    );
    rerender(section("org-1"));
    expect(
      within(goalRow).queryByRole("img", { name: /^Starred / }),
    ).toBeNull();
    expect(
      within(taskRow()).getByRole("img", { name: /^Starred / }),
    ).toBeInTheDocument();

    isStarred.mockReturnValue(false);
    rerender(section("org-2"));
    expect(useEntityStars).toHaveBeenLastCalledWith("org-2");
    expect(screen.queryByRole("img", { name: /^Starred / })).toBeNull();
    expect(useWorkItemMock).not.toHaveBeenCalled();
    expect(usePlanMock).not.toHaveBeenCalled();
  });

  it("selects without navigation or storage changes and sends complete drag and bulk targets", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "0f9ad3e4-e837-549a-9683-827ea803ad19",
            entityType: "task",
          },
          {
            entityId: "ae676ada-3b87-52e0-b285-a0c4c73f0d9b",
            entityType: "task",
          },
          {
            entityId: "e0e404ec-8813-58eb-9e48-b0359c3a4042",
            entityType: "task",
          },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/unchanged"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <LocationProbe />
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
    await screen.findByTestId(
      "open-item-task-0f9ad3e4-e837-549a-9683-827ea803ad19",
    );
    const stored = localStorage.getItem("open-items:v1:project-1");
    const row = (id: string) => screen.getByTestId(`open-item-task-${id}`);
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-interaction-0f9ad3e4-e837-549a-9683-827ea803ad19",
          ),
        ).getByText("Select items"),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(row("ae676ada-3b87-52e0-b285-a0c4c73f0d9b")).getByRole("link"),
      );
    });
    expect(row("0f9ad3e4-e837-549a-9683-827ea803ad19")).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(row("ae676ada-3b87-52e0-b285-a0c4c73f0d9b")).toHaveAttribute(
      "data-selected",
      "true",
    );
    expect(screen.getByText("Selecting 2 · Esc to clear")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/unchanged");
    expect(localStorage.getItem("open-items:v1:project-1")).toBe(stored);
    const payload = (id: string) =>
      entityDragSourceMock.mock.calls
        .filter(([input]) => input.entityRef.entityId === id)
        .at(-1)?.[0].content;
    expect(payload("0f9ad3e4-e837-549a-9683-827ea803ad19")).toMatchObject({
      type: "entities",
      data: [
        { entityId: "0f9ad3e4-e837-549a-9683-827ea803ad19" },
        { entityId: "ae676ada-3b87-52e0-b285-a0c4c73f0d9b" },
      ],
    });
    expect(payload("e0e404ec-8813-58eb-9e48-b0359c3a4042")).toMatchObject({
      type: "entity",
      data: { entityId: "e0e404ec-8813-58eb-9e48-b0359c3a4042" },
    });
    await act(async () => {
      fireEvent.click(
        within(row("ae676ada-3b87-52e0-b285-a0c4c73f0d9b")).getByRole("link"),
      );
    });
    expect(row("ae676ada-3b87-52e0-b285-a0c4c73f0d9b")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(payload("0f9ad3e4-e837-549a-9683-827ea803ad19")).toMatchObject({
      type: "entity",
      data: { entityId: "0f9ad3e4-e837-549a-9683-827ea803ad19" },
    });
    await act(async () => {
      fireEvent.click(
        within(row("ae676ada-3b87-52e0-b285-a0c4c73f0d9b")).getByRole("link"),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-interaction-0f9ad3e4-e837-549a-9683-827ea803ad19",
          ),
        ).getByText("Remove items from Open"),
      );
    });
    expect(
      screen.queryByTestId(
        "open-item-task-0f9ad3e4-e837-549a-9683-827ea803ad19",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-task-ae676ada-3b87-52e0-b285-a0c4c73f0d9b",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-e0e404ec-8813-58eb-9e48-b0359c3a4042"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/unchanged");
  });

  it("Remove Others keeps every selected item when opened on a selected row", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "0f9ad3e4-e837-549a-9683-827ea803ad19",
            entityType: "task",
          },
          {
            entityId: "ae676ada-3b87-52e0-b285-a0c4c73f0d9b",
            entityType: "task",
          },
          {
            entityId: "e0e404ec-8813-58eb-9e48-b0359c3a4042",
            entityType: "task",
          },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/unchanged"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
    const row = (id: string) => screen.getByTestId(`open-item-task-${id}`);
    const interaction = (id: string) =>
      screen.getByTestId(`open-item-interaction-${id}`);
    await screen.findByTestId(
      "open-item-task-0f9ad3e4-e837-549a-9683-827ea803ad19",
    );
    await act(async () => {
      fireEvent.click(
        within(interaction("0f9ad3e4-e837-549a-9683-827ea803ad19")).getByText(
          "Select items",
        ),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(row("ae676ada-3b87-52e0-b285-a0c4c73f0d9b")).getByRole("link"),
      );
    });

    await act(async () => {
      fireEvent.click(
        within(interaction("0f9ad3e4-e837-549a-9683-827ea803ad19")).getByRole(
          "button",
          { name: "Remove Others" },
        ),
      );
    });

    expect(row("0f9ad3e4-e837-549a-9683-827ea803ad19")).toBeInTheDocument();
    expect(row("ae676ada-3b87-52e0-b285-a0c4c73f0d9b")).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-task-e0e404ec-8813-58eb-9e48-b0359c3a4042",
      ),
    ).not.toBeInTheDocument();
  });

  it("prunes selection through the actual search and section disclosure projection", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "0f9ad3e4-e837-549a-9683-827ea803ad19",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Alpha",
              taskType: "STANDARD",
            },
          },
          {
            entityId: "ae676ada-3b87-52e0-b285-a0c4c73f0d9b",
            entityType: "task",
            presentation: { kind: "task", label: "Beta", taskType: "STANDARD" },
          },
        ],
      }),
    );
    const view = (searchTerm: string) => (
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection
            organizationId="org-1"
            projectId="project-1"
            searchTerm={searchTerm}
          />
          <CanonicalOpenItemsReady />
        </OpenItemsProvider>
      </MemoryRouter>
    );
    const { rerender } = render(view(""));
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );
    await screen.findByTestId(
      "open-item-task-0f9ad3e4-e837-549a-9683-827ea803ad19",
    );
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-interaction-0f9ad3e4-e837-549a-9683-827ea803ad19",
          ),
        ).getByText("Select items"),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-task-ae676ada-3b87-52e0-b285-a0c4c73f0d9b",
          ),
        ).getByRole("link"),
      );
    });
    rerender(view("Alpha"));
    expect(
      screen.queryByTestId(
        "open-item-task-ae676ada-3b87-52e0-b285-a0c4c73f0d9b",
      ),
    ).not.toBeInTheDocument();
    rerender(view(""));
    expect(
      screen.getByTestId("open-item-task-0f9ad3e4-e837-549a-9683-827ea803ad19"),
    ).toHaveAttribute("data-selected", "true");
    expect(
      screen.getByTestId("open-item-task-ae676ada-3b87-52e0-b285-a0c4c73f0d9b"),
    ).toHaveAttribute("data-selected", "false");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse open" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Expand open" }));
    });
    expect(
      await screen.findByTestId(
        "open-item-task-0f9ad3e4-e837-549a-9683-827ea803ad19",
      ),
    ).toHaveAttribute("data-selected", "false");
  });

  it("never loads names for restored rows and renders no fallback label", async () => {
    preserveMissingPresentation = true;
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "0785c1b5-7ffa-5e40-9094-0c0f01a857fd",
            entityType: "initiative",
          },
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
          {
            entityId: "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
            entityType: "goal",
          },
          {
            entityId: "155464cd-7395-55bc-8e6d-8d97a0f13c0c",
            entityType: "conversation",
          },
          {
            entityId: "f60e4e1c-9801-514f-a431-e9e18905dae7",
            entityType: "design_doc",
          },
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
          },
          {
            entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
            entityType: "plan",
          },
          {
            entityId: "e7a84e1f-d87c-5ea6-9669-0c1294ca2dfa",
            entityType: "proposal",
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    expect(useWorkItemMock).not.toHaveBeenCalled();
    expect(useAgentSessionMock).not.toHaveBeenCalled();
    expect(useDesignDocMock).not.toHaveBeenCalled();
    expect(usePlanMock).not.toHaveBeenCalled();
    expect(useServiceMock).not.toHaveBeenCalled();
    expect(useWorkItemTypesMock).toHaveBeenCalled();
    expect(
      screen.queryByTestId(
        "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-design_doc-f60e4e1c-9801-514f-a431-e9e18905dae7",
      ),
    ).not.toBeInTheDocument();
  });

  it("filters by stable labels and limits session overlays to visible rows", async () => {
    const onVisibleCountChange = vi.fn();
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
            presentation: {
              kind: "agent_session",
              label: "Visible session",
              sessionType: AgentSessionType.Coding,
            },
          },
          {
            entityId: "4b59168a-1997-538e-aca6-35808876a2ae",
            entityType: "agent_session",
            presentation: {
              kind: "agent_session",
              label: "Hidden session",
              sessionType: AgentSessionType.Coding,
            },
          },
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Visible task",
              taskType: "STANDARD",
            },
          },
        ],
      }),
    );

    const { rerender } = render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection
            organizationId="org-1"
            projectId="project-1"
            searchTerm="  VISIBLE SESSION "
            onVisibleCountChange={onVisibleCountChange}
          />
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

    expect(screen.getByText("OPEN (1)")).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-agent_session-4b59168a-1997-538e-aca6-35808876a2ae",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(useAgentSessionCurrentStatesMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      ["885f5380-2285-5451-af9f-d9a4a474d503"],
    );
    expect(useAgentSessionOutputAttentionsMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      ["885f5380-2285-5451-af9f-d9a4a474d503"],
    );
    expect(onVisibleCountChange).toHaveBeenLastCalledWith(1);

    rerender(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection
            organizationId="org-1"
            projectId="project-1"
            searchTerm=""
            onVisibleCountChange={onVisibleCountChange}
          />
          <CanonicalOpenItemsReady />
        </OpenItemsProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId(
        "open-item-agent_session-4b59168a-1997-538e-aca6-35808876a2ae",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toBeInTheDocument();
    expect(screen.getByText("OPEN (3)")).toBeInTheDocument();
    expect(screen.getByText("Visible task")).toHaveStyle({
      fontSize: "0.875rem",
    });
    expect(onVisibleCountChange).toHaveBeenLastCalledWith(3);
  });

  it("keeps non-530dc1bc-d4f6-51ec-bf1e-41fbfc3646c9 lifecycle states, user readiness, and only the 530dc1bc-d4f6-51ec-bf1e-41fbfc3646c9 1e174460-bac2-51df-9c55-77b9e3392449 fallback", () => {
    const activeStates = [
      AgentSessionCurrentState.Starting,
      AgentSessionCurrentState.Thinking,
      AgentSessionCurrentState.Writing,
      AgentSessionCurrentState.AwaitingApproval,
      AgentSessionCurrentState.PlanReady,
      AgentSessionCurrentState.ImplementationReady,
    ];

    for (const currentState of activeStates) {
      expect(
        isActiveAgentSessionForOpenItems(currentState, undefined, undefined),
      ).toBe(true);
    }
    expect(
      isActiveAgentSessionForOpenItems(
        AgentSessionCurrentState.Idle,
        undefined,
        undefined,
      ),
    ).toBe(false);
    expect(
      isActiveAgentSessionForOpenItems(
        undefined,
        undefined,
        ConversationPhase.Reviewing,
      ),
    ).toBe(false);
    expect(
      isActiveAgentSessionForOpenItems(
        AgentSessionCurrentState.Idle,
        undefined,
        ConversationPhase.Reviewing,
      ),
    ).toBe(true);
    expect(
      isActiveAgentSessionForOpenItems(
        AgentSessionCurrentState.Idle,
        AgentSessionOutputAttentionState.MessageReady,
        ConversationPhase.Idle,
      ),
    ).toBe(true);
    expect(
      isActiveAgentSessionForOpenItems(
        AgentSessionCurrentState.Thinking,
        undefined,
        ConversationPhase.Reviewing,
      ),
    ).toBe(true);
  });

  it("filters only inactive sessions after preserving grouped and pinned order", async () => {
    const agentSession = (
      entityId: string,
      label: string,
      conversationId: string,
      extra: Record<string, unknown> = {},
    ) => ({
      entityId,
      entityType: "agent_session",
      presentation: {
        kind: "agent_session",
        label,
        sessionType: AgentSessionType.Coding,
        entityConversationRoute: {
          conversationId,
          entityId: "7d682971-83d7-5310-8e71-8d59467a0e2d",
          entityType: "TASK",
        },
      },
      ...extra,
    });
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          agentSession(
            "a4cc452d-ca63-58a4-b8c5-36369af2bf5c",
            "Inactive pinned",
            "3ba4aece-0678-59bc-90c7-871692c7a7f7",
            {
              groupId: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
              pinned: true,
              firstAddedOrder: 1,
            },
          ),
          agentSession(
            "ad8994d8-93d7-5d33-b49d-a8034356d7d9",
            "Ready plan",
            "9a190a15-88de-5ca1-98c2-596b8b7c9791",
            {
              groupId: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
              pinned: true,
              firstAddedOrder: 2,
            },
          ),
          agentSession(
            "c9cedf4c-bc0b-5d5d-96ed-0fef9c4f6d7d",
            "Active d5aa01f8-da79-5a3c-9def-4d0db14725f0",
            "8ed96106-462b-563b-9f0d-1a677b90ad92",
            {
              groupId: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
              firstAddedOrder: 4,
              lineage: [
                {
                  entityType: "task",
                  entityId: "348e8996-2071-5c54-81d0-32f05811dba6",
                },
              ],
            },
          ),
          agentSession(
            "1e174460-bac2-51df-9c55-77b9e3392449",
            "Reviewing",
            "4c481de7-c162-5c77-b9fc-8b0fde616df5",
            {
              groupId: "fabd7a37-8ccb-5877-b9de-1ba07d393616",
              firstAddedOrder: 4,
            },
          ),
          agentSession(
            "0dbfc02a-08ec-5b9f-875a-32bb9c28513a",
            "Message ready",
            "1d055add-394d-5e3f-83df-2399801b1d61",
            {
              firstAddedOrder: 5,
            },
          ),
          agentSession(
            "530dc1bc-d4f6-51ec-bf1e-41fbfc3646c9",
            "Idle",
            "2ab08a49-8515-504f-8206-2d7b15599261",
            {
              firstAddedOrder: 6,
            },
          ),
          {
            entityId: "348e8996-2071-5c54-81d0-32f05811dba6",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Visible 071ae9ab-1d93-54f4-89a9-3560d8a088c6 task",
              taskType: "STANDARD",
            },
            groupId: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
            firstAddedOrder: 3,
          },
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            presentation: {
              kind: "task",
              label: "Unrelated task",
              taskType: "STANDARD",
            },
            firstAddedOrder: 7,
          },
        ],
        groups: [
          {
            id: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
            name: "First",
            order: 0,
            collapsed: false,
          },
          {
            id: "fabd7a37-8ccb-5877-b9de-1ba07d393616",
            name: "Second",
            order: 1,
            collapsed: false,
          },
        ],
      }),
    );
    useAgentSessionCurrentStatesMock.mockReturnValue({
      currentStateById: {
        "a4cc452d-ca63-58a4-b8c5-36369af2bf5c": {
          currentState: AgentSessionCurrentState.Idle,
          revision: 1,
        },
        "ad8994d8-93d7-5d33-b49d-a8034356d7d9": {
          currentState: AgentSessionCurrentState.PlanReady,
          revision: 1,
        },
        "c9cedf4c-bc0b-5d5d-96ed-0fef9c4f6d7d": {
          currentState: AgentSessionCurrentState.Thinking,
          revision: 1,
        },
        "1e174460-bac2-51df-9c55-77b9e3392449": {
          currentState: AgentSessionCurrentState.Idle,
          revision: 1,
        },
        "0dbfc02a-08ec-5b9f-875a-32bb9c28513a": {
          currentState: AgentSessionCurrentState.Idle,
          revision: 1,
        },
        "530dc1bc-d4f6-51ec-bf1e-41fbfc3646c9": {
          currentState: AgentSessionCurrentState.Idle,
          revision: 1,
        },
      },
      isFetching: false,
    });
    useAgentSessionOutputAttentionsMock.mockReturnValue({
      "0dbfc02a-08ec-5b9f-875a-32bb9c28513a": {
        state: AgentSessionOutputAttentionState.MessageReady,
        revision: 1,
      },
    });
    useConversationPhasesMock.mockReturnValue({
      "4c481de7-c162-5c77-b9fc-8b0fde616df5": {
        phase: ConversationPhase.Reviewing,
        revision: 1,
        transitionedAt: "2026-09-30T00:00:00.000Z",
      },
    });

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    const storedBeforeToggle = localStorage.getItem("open-items:v1:project-1");
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Show active only" })[0]!,
      );
    });

    const visibleRows = screen
      .getAllByTestId(/^open-item-(?:agent_session|task)-/)
      .map((row) => row.getAttribute("data-testid"));
    expect(visibleRows).toEqual([
      "open-item-agent_session-ad8994d8-93d7-5d33-b49d-a8034356d7d9",
      "open-item-task-348e8996-2071-5c54-81d0-32f05811dba6",
      "open-item-agent_session-c9cedf4c-bc0b-5d5d-96ed-0fef9c4f6d7d",
      "open-item-agent_session-1e174460-bac2-51df-9c55-77b9e3392449",
      "open-item-agent_session-0dbfc02a-08ec-5b9f-875a-32bb9c28513a",
    ]);
    expect(
      screen.queryByTestId(
        "open-item-agent_session-a4cc452d-ca63-58a4-b8c5-36369af2bf5c",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-agent_session-530dc1bc-d4f6-51ec-bf1e-41fbfc3646c9",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("OPEN (5)")).toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-348e8996-2071-5c54-81d0-32f05811dba6"),
    ).toHaveAttribute("data-depth", "0");
    expect(
      screen.getByTestId(
        "open-item-agent_session-c9cedf4c-bc0b-5d5d-96ed-0fef9c4f6d7d",
      ),
    ).toHaveAttribute("data-depth", "1");
    expect(localStorage.getItem("open-items:v1:project-1")).toBe(
      storedBeforeToggle,
    );
    expect(useAgentSessionCurrentStatesMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      [
        "a4cc452d-ca63-58a4-b8c5-36369af2bf5c",
        "ad8994d8-93d7-5d33-b49d-a8034356d7d9",
        "c9cedf4c-bc0b-5d5d-96ed-0fef9c4f6d7d",
        "1e174460-bac2-51df-9c55-77b9e3392449",
        "0dbfc02a-08ec-5b9f-875a-32bb9c28513a",
        "530dc1bc-d4f6-51ec-bf1e-41fbfc3646c9",
      ],
    );
  });

  it("hydrates deduplicated agent sessions and renders state without persisting it", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
          },
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
          },
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );
    useAgentSessionCurrentStatesMock.mockReturnValue({
      currentStateById: {
        "885f5380-2285-5451-af9f-d9a4a474d503": {
          currentState: AgentSessionCurrentState.Thinking,
          revision: 2,
          transitionedAt: "2026-07-24T11:00:00.000Z",
        },
      },
      isFetching: false,
    });

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    expect(useAgentSessionCurrentStatesMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      ["885f5380-2285-5451-af9f-d9a4a474d503"],
    );
    const stateIndicator = screen.getByTestId(
      "agent-session-current-state-indicator",
    );
    expect(stateIndicator).toHaveAccessibleName("Thinking");
    expect(stateIndicator).toHaveAttribute("data-presentation", "icon");
    expect(stateIndicator.nextElementSibling).toHaveTextContent(
      "Resolve launch blockers",
    );
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).not.toContain(
      "THINKING",
    );
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).not.toContain(
      "transitionedAt",
    );
  });

  it("renders revisioned output attention as an icon without persisting it", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
          },
        ],
      }),
    );
    useAgentSessionOutputAttentionsMock.mockReturnValue({
      "885f5380-2285-5451-af9f-d9a4a474d503": {
        state: AgentSessionOutputAttentionState.MessageReady,
        revision: 3,
      },
    });

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    expect(useAgentSessionOutputAttentionsMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      ["885f5380-2285-5451-af9f-d9a4a474d503"],
    );
    expect(
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toHaveAccessibleName("New response");
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).not.toContain(
      "MESSAGE_READY",
    );
  });

  it("does not use canonical active-row identity to hide output attention", async () => {
    currentCanonicalPageMock.mockReturnValue(
      createEntityActivation(
        "agent_session",
        "885f5380-2285-5451-af9f-d9a4a474d503",
        null,
      ),
    );
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
          },
        ],
      }),
    );
    useAgentSessionOutputAttentionsMock.mockReturnValue({
      "885f5380-2285-5451-af9f-d9a4a474d503": {
        state: AgentSessionOutputAttentionState.MessageReady,
        revision: 3,
      },
    });

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toHaveAccessibleName("New response");
  });

  it("renders canonical lifecycle and output attention independently", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
            presentation: {
              kind: "agent_session",
              label: "Review launch blockers",
              sessionType: AgentSessionType.EntityConversation,
              entityConversationRoute: {
                conversationId: "155464cd-7395-55bc-8e6d-8d97a0f13c0c",
                entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
                entityType: "TASK",
              },
            },
          },
        ],
      }),
    );
    useConversationPhasesMock.mockReturnValue({
      "155464cd-7395-55bc-8e6d-8d97a0f13c0c": {
        phase: ConversationPhase.Reviewing,
        revision: 1,
        transitionedAt: "2026-08-07T00:00:00.000Z",
      },
    });
    useAgentSessionCurrentStatesMock.mockReturnValue({
      currentStateById: {
        "885f5380-2285-5451-af9f-d9a4a474d503": {
          currentState: AgentSessionCurrentState.Thinking,
          revision: 2,
          transitionedAt: "2026-07-24T11:00:00.000Z",
        },
      },
      isFetching: false,
    });
    useAgentSessionOutputAttentionsMock.mockReturnValue({
      "885f5380-2285-5451-af9f-d9a4a474d503": {
        state: AgentSessionOutputAttentionState.MessageReady,
        revision: 3,
      },
    });

    const { rerender } = render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.queryByTestId("conversation-phase-indicator"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("data-current-state", AgentSessionCurrentState.Thinking);
    expect(
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toBeInTheDocument();

    useConversationPhasesMock.mockReturnValue({
      "155464cd-7395-55bc-8e6d-8d97a0f13c0c": {
        phase: ConversationPhase.Idle,
        revision: 2,
        transitionedAt: "2026-08-07T00:01:00.000Z",
      },
    });
    rerender(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <CanonicalOpenItemsReady />
        </OpenItemsProvider>
      </MemoryRouter>,
    );

    expect(
      screen.queryByTestId("conversation-phase-indicator"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("data-current-state", AgentSessionCurrentState.Thinking);
    expect(
      screen.getByTestId("agent-session-output-attention-indicator"),
    ).toBeInTheDocument();

    useAgentSessionOutputAttentionsMock.mockReturnValue({});
    rerender(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <CanonicalOpenItemsReady />
        </OpenItemsProvider>
      </MemoryRouter>,
    );

    expect(
      screen.queryByTestId("conversation-phase-indicator"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-current-state-indicator"),
    ).toHaveAttribute("data-current-state", AgentSessionCurrentState.Thinking);
    expect(
      screen.queryByTestId("agent-session-output-attention-indicator"),
    ).not.toBeInTheDocument();
  });

  it("projects only open route ancestors for plan-step and standalone sessions", () => {
    const planItems = projectOpenItems([
      {
        entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
        entityType: "agent_session",
        lineage: buildAgentSessionNavigationLineage({
          routeFamily: "plan",
          planId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
          stageId: "2f04f098-401f-5a69-9a62-0a25b49092cd",
          stepId: "6edfaa9b-06ce-51a1-adf2-b3a7818ccc98",
          taskId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        }),
      },
      {
        entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        entityType: "task",
        lineage: buildPlanStepNavigationLineage({
          planId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
          stageId: "2f04f098-401f-5a69-9a62-0a25b49092cd",
          stepId: "6edfaa9b-06ce-51a1-adf2-b3a7818ccc98",
          taskId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        }),
      },
      { entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7", entityType: "plan" },
    ]);
    expect(planItems.map(({ depth, item }) => [item.entityId, depth])).toEqual([
      ["8013eea4-4c54-5f6a-ae42-d9188e822bf7", 0],
      ["e8a970e8-3ee8-5d4f-a62e-d273e23779ab", 1],
      ["885f5380-2285-5451-af9f-d9a4a474d503", 2],
    ]);

    const standaloneItems = projectOpenItems([
      {
        entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
        entityType: "agent_session",
        lineage: buildAgentSessionNavigationLineage({
          routeFamily: "task",
          taskId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        }),
      },
      {
        entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        entityType: "task",
        lineage: buildTaskNavigationLineage({
          taskId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
          parentTaskId: "e8fcc19c-6e24-5444-8754-216f56ad8ca6",
        }),
      },
      { entityId: "e8fcc19c-6e24-5444-8754-216f56ad8ca6", entityType: "task" },
    ]);
    expect(
      standaloneItems.map(({ depth, item }) => [item.entityId, depth]),
    ).toEqual([
      ["e8fcc19c-6e24-5444-8754-216f56ad8ca6", 0],
      ["e8a970e8-3ee8-5d4f-a62e-d273e23779ab", 1],
      ["885f5380-2285-5451-af9f-d9a4a474d503", 2],
    ]);
  });

  it("highlights exactly the local canonical identity while working-set order changes", async () => {
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

    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
          {
            entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
            entityType: "task",
          },
        ],
      }),
    );
    currentCanonicalPageMock.mockReturnValue(
      createEntityActivation(
        "task",
        "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        null,
      ),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <ManualActivationControls />
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
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toHaveAttribute("data-active", "false");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Activate task 2" }));
    });

    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toHaveAttribute("data-active", "false");
    expect(
      screen.getByRole("button", { name: "Preview Task Two" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Task Two" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    { taskType: "CONTRACT", iconKey: "contract" },
    { taskType: "FEATURE", iconKey: "feature" },
    { taskType: "workflow", iconKey: "workflow" },
  ])(
    "renders the registry-backed icon for $taskType",
    async ({ taskType, iconKey }) => {
      const definition = createWorkItemDefinition(taskType, iconKey);
      setWorkItemTypeDefinitions(definition);
      useWorkItemMock.mockReturnValue({
        error: null,
        isLoading: false,
        workItem: {
          id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
          name: `${taskType} item`,
          type: taskType,
        },
      } as unknown as ReturnType<typeof useWorkItem>);
      localStorage.setItem(
        "open-items:v1:project-1",
        JSON.stringify({
          version: 1,
          items: [
            {
              entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
              entityType: "task",
            },
          ],
        }),
      );

      render(
        <MemoryRouter initialEntries={["/projects/project-1"]}>
          <OpenItemsProvider
            organizationId="org-1"
            userId={openItemsTestUserId()}
            projectId="project-1"
          >
            <OpenItemsSection organizationId="org-1" projectId="project-1" />
            <CanonicalOpenItemsReady />
          </OpenItemsProvider>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("canonical-open-items-ready"),
        ).toHaveAttribute("data-ready", "true"),
      );

      expect(
        screen.getByTestId(`open-item-registry-icon-${taskType}`),
      ).toHaveAttribute("data-entity-type", taskType);
      expect(resolveWorkItemIconPresentationMock).toHaveBeenCalledWith(
        taskType,
        definition,
        undefined,
      );
    },
  );

  it("passes registry provenance and an independent custom color to the shared presentation resolver", async () => {
    const actual = await vi.importActual<
      typeof import("@hey-hey/ui-common/utils")
    >("@hey-hey/ui-common/utils");
    resolveWorkItemIconPresentationMock.mockImplementation(
      actual.resolveWorkItemIconPresentation,
    );
    const definition = {
      ...createWorkItemDefinition("CUSTOM", "star"),
      colorKey: "secondary" as const,
    };
    useWorkItemTypesMock.mockReturnValue({
      workItemTypes: [{ definition, effectiveSource: "PROJECT_CUSTOM" }],
    } as unknown as ReturnType<typeof useWorkItemTypes>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "f86b3f70-3334-5776-80aa-d3a8435664e9",
            entityType: "task",
            presentation: {
              kind: "task",
              taskType: "CUSTOM",
              label: "Custom example",
            },
          },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
    expect(resolveWorkItemIconPresentationMock).toHaveBeenCalledWith(
      "CUSTOM",
      definition,
      "PROJECT_CUSTOM",
    );
    expect(screen.getByTestId("open-item-registry-icon-CUSTOM")).toHaveStyle({
      backgroundColor: "#9c27b0",
      color: "#ffffff",
    });
  });
  it("withholds a typed icon when its registry definition is unavailable", async () => {
    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: {
        id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        name: "Unresolved contract",
        type: "CONTRACT",
      },
    } as unknown as ReturnType<typeof useWorkItem>);
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
              label: "Unresolved contract",
              taskType: "CONTRACT",
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.queryByTestId("open-item-registry-icon-CONTRACT"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Unresolved contract")).toBeInTheDocument();
  });

  it("backfills a missing iconKey for an existing built-in Contract definition", async () => {
    const definition = {
      key: "CONTRACT",
      name: "CONTRACT",
    } as WorkItemTypeDefinitionDto;
    setWorkItemTypeDefinitions(definition);
    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: {
        id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        name: "Contract item",
        type: "CONTRACT",
      },
    } as unknown as ReturnType<typeof useWorkItem>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.getByTestId("open-item-registry-icon-CONTRACT"),
    ).toHaveAttribute("data-entity-type", "CONTRACT");
    expect(resolveWorkItemIconPresentationMock).toHaveBeenCalledWith(
      "CONTRACT",
      expect.objectContaining({ key: "CONTRACT", iconKey: "contract" }),
      undefined,
    );
    expect(getEntityColorsMock).toHaveBeenCalledWith("CONTRACT");
  });

  it("backfills the dedicated Task Monitor icon for an existing definition", async () => {
    const definition = {
      key: "TASK_MONITOR",
      name: "Task Monitor",
    } as WorkItemTypeDefinitionDto;
    setWorkItemTypeDefinitions(definition);
    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: {
        id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        name: "Monitor item",
        type: "TASK_MONITOR",
      },
    } as unknown as ReturnType<typeof useWorkItem>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.getByTestId("open-item-registry-icon-TASK_MONITOR"),
    ).toHaveAttribute("data-entity-type", "TASK_MONITOR");
    expect(resolveWorkItemIconPresentationMock).toHaveBeenCalledWith(
      "TASK_MONITOR",
      expect.objectContaining({ key: "TASK_MONITOR", iconKey: "task" }),
      undefined,
    );
    expect(getEntityColorsMock).toHaveBeenCalledWith("TASK_MONITOR");
  });

  it("withholds a feature icon while its registry definition is unavailable", async () => {
    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: {
        id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        name: "Unresolved feature",
        type: "FEATURE",
      },
    } as unknown as ReturnType<typeof useWorkItem>);
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
              label: "Unresolved feature",
              taskType: "FEATURE",
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    expect(screen.queryByTestId("entity-icon-feature")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("open-item-registry-icon-FEATURE"),
    ).not.toBeInTheDocument();
  });

  it("fails closed for legacy task rows without taskType", async () => {
    preserveMissingPresentation = true;
    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: {
        id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        name: "Legacy task",
      },
    } as unknown as ReturnType<typeof useWorkItem>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.queryByTestId("open-item-registry-icon-STANDARD"),
    ).not.toBeInTheDocument();
    expect(resolveWorkItemIconPresentationMock).not.toHaveBeenCalled();
  });

  it("binds supported rows to canonical entity drag metadata inside the interaction wrapper", async () => {
    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: {
        id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        name: "Feature One",
        type: "FEATURE",
      },
    } as unknown as ReturnType<typeof useWorkItem>);
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
              label: "Feature One",
              taskType: "FEATURE",
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      await screen.findByTestId(
        "open-item-interaction-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).toHaveAttribute("data-entity-type", TargetEntityType.Task);
    expect(
      screen.getByTestId(
        "open-item-interaction-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).toHaveAttribute("data-entity-subtype", "FEATURE");

    const dragCallIndex = entityDragSourceMock.mock.calls.findIndex(
      ([input]) =>
        input.entityRef.entityId === "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );
    expect(dragCallIndex).toBeGreaterThanOrEqual(0);
    expect(entityDragSourceMock.mock.calls[dragCallIndex]?.[0]).toMatchObject({
      entityRef: {
        entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        entityType: TargetEntityType.Task,
        entityTitle: "Feature One",
        entitySubtype: "FEATURE",
      },
      idScope: "open-items-task",
    });
    expect(
      entityDragSourceMock.mock.results[dragCallIndex]?.value.setNodeRef,
    ).toHaveBeenCalledWith(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    );
  });

  it("keeps Agent Session Explorer rows navigable, previewable, and inert drag sources", async () => {
    const agentSessionId = "e4c4a151-9c17-4365-8a4b-379418fe0e47";
    const agentSessionName = "Review release notes";
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: agentSessionId,
            entityType: "agent_session",
            presentation: {
              kind: "agent_session",
              label: agentSessionName,
              sessionType: AgentSessionType.Coding,
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    const sessionLink = await screen.findByRole("link", {
      name: new RegExp(agentSessionName),
    });
    expect(sessionLink).toHaveAttribute(
      "href",
      `/projects/project-1/sessions/${agentSessionId}`,
    );
    expect(
      screen.getByTestId(`open-item-interaction-${agentSessionId}`),
    ).toHaveAttribute("data-entity-type", TargetEntityType.AgentSession);

    const dragCallIndex = entityDragSourceMock.mock.calls.findIndex(
      ([input]) => input.entityRef.entityId === agentSessionId,
    );
    expect(dragCallIndex).toBeGreaterThanOrEqual(0);
    expect(entityDragSourceMock.mock.calls[dragCallIndex]?.[0]).toMatchObject({
      entityRef: {
        entityId: agentSessionId,
        entityType: TargetEntityType.AgentSession,
        entityTitle: agentSessionName,
      },
      idScope: "open-items-agent_session",
    });

    const sessionRow = screen.getByTestId(
      `open-item-agent_session-${agentSessionId}`,
    );
    await act(async () => {
      fireEvent.mouseEnter(sessionRow);
    });
    await screen.findByTestId("entity-hover-card");
    expect(entityHoverCardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: agentSessionId,
        entityType: "agent_session",
      }),
    );
    expect(useAgentSessionMock).not.toHaveBeenCalled();
  });

  it("supports goal links, activation identity, interaction metadata, and preview", async () => {
    useWorkItemMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItem: {
        id: "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
        name: "Ship the goal",
        type: "GOAL",
      },
    } as unknown as ReturnType<typeof useWorkItem>);
    currentCanonicalPageMock.mockReturnValue(
      createEntityActivation(
        "goal",
        "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
        null,
      ),
    );
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
            entityType: "goal",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    const row = await screen.findByTestId(
      "open-item-goal-6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
    );
    expect(row).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("link", { name: /Ship the goal/ })).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
    );
    expect(
      screen.getByTestId(
        "open-item-interaction-6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
      ),
    ).toHaveAttribute("data-entity-type", "GOAL");
    expect(
      screen.getByTestId(
        "open-item-interaction-6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
      ),
    ).toHaveAttribute("data-entity-subtype", "GOAL");
    expect(entityHoverCardMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.mouseEnter(row);
    });
    await waitFor(() => {
      expect(entityHoverCardMock).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
          entityType: "goal",
        }),
      );
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Preview Ship the goal" }),
      );
    });
    expect(openPreviewMock).toHaveBeenCalledWith({
      entityId: "6f00a8d2-918f-5fbc-8ed3-82fa8a6d725e",
      entityType: "goal",
    });
  });

  it("renders pinned indicators and wires state-dependent pin actions", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
            entityType: "task",
            firstAddedOrder: 2,
            pinned: true,
          },
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            firstAddedOrder: 1,
          },
          {
            entityId: "ca4dd2f6-d35b-5130-aa34-2e74840afbf7",
            entityType: "task",
            firstAddedOrder: 3,
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.queryByTestId("open-items-pinned-group"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("open-items-unpinned-group"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(
        "open-item-pinned-indicator-task-bbc04762-4810-53b6-a5a9-7075c179551f",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-pinned-indicator-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByTestId(/^open-item-task-/)
        .map((element) => element.dataset.testid),
    ).toEqual([
      "open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f",
      "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      "open-item-task-ca4dd2f6-d35b-5130-aa34-2e74840afbf7",
    ]);
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Pin" })).toHaveLength(2);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Pin" })[0]!);
    });

    expect(readOpenItemsTestCache("project-1").items).toEqual([
      expect.objectContaining({
        entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        entityType: "task",
        firstAddedOrder: 1,
        pinned: true,
      }),
      expect.objectContaining({
        entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
        entityType: "task",
        firstAddedOrder: 2,
        pinned: true,
      }),
      expect.objectContaining({
        entityId: "ca4dd2f6-d35b-5130-aa34-2e74840afbf7",
        entityType: "task",
        firstAddedOrder: 3,
      }),
    ]);
  });

  it("renders named groups before ungrouped Open Items", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "3faea926-9335-5614-8a45-6176886482c2",
            entityType: "task",
            firstAddedOrder: 1,
          },
          {
            entityId: "d5aa01f8-da79-5a3c-9def-4d0db14725f0",
            entityType: "task",
            groupId: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
            firstAddedOrder: 2,
          },
        ],
        groups: [
          {
            id: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
            name: "Focus",
            order: 0,
            collapsed: false,
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    const groupHeader = screen.getByTestId("open-items-group-header");
    const ungroupedRow = screen.getByTestId(
      "open-item-task-3faea926-9335-5614-8a45-6176886482c2",
    );
    expect(
      groupHeader.compareDocumentPosition(ungroupedRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  describe("group header count and working-session indicators", () => {
    const groupId = "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf";
    const taskId = "348e8996-2071-5c54-81d0-32f05811dba6";
    const thinkingId = "c9cedf4c-bc0b-5d5d-96ed-0fef9c4f6d7d";
    const readyId = "0dbfc02a-08ec-5b9f-875a-32bb9c28513a";
    const idleId = "530dc1bc-d4f6-51ec-bf1e-41fbfc3646c9";

    const seedGroup = (collapsed: boolean, sessionIds: readonly string[]) => {
      const agentSession = (entityId: string, extra = {}) => ({
        entityId,
        entityType: "agent_session",
        presentation: {
          kind: "agent_session",
          label: `Session ${entityId}`,
          sessionType: AgentSessionType.Coding,
        },
        groupId,
        ...extra,
      });
      localStorage.setItem(
        "open-items:v1:project-1",
        JSON.stringify({
          version: 1,
          items: [
            {
              entityId: taskId,
              entityType: "task",
              presentation: {
                kind: "task",
                label: "Parent task",
                taskType: "STANDARD",
              },
              groupId,
              firstAddedOrder: 1,
            },
            ...sessionIds.map((entityId, index) =>
              agentSession(entityId, {
                firstAddedOrder: index + 2,
                lineage:
                  entityId === thinkingId
                    ? [{ entityType: "task", entityId: taskId }]
                    : undefined,
              }),
            ),
          ],
          groups: [{ id: groupId, name: "Work", order: 0, collapsed }],
        }),
      );
      useAgentSessionCurrentStatesMock.mockReturnValue({
        currentStateById: {
          [thinkingId]: {
            currentState: AgentSessionCurrentState.Thinking,
            revision: 1,
          },
          [readyId]: {
            currentState: AgentSessionCurrentState.Idle,
            revision: 1,
          },
          [idleId]: {
            currentState: AgentSessionCurrentState.Idle,
            revision: 1,
          },
        },
        isFetching: false,
      });
      useAgentSessionOutputAttentionsMock.mockReturnValue({
        [readyId]: {
          state: AgentSessionOutputAttentionState.MessageReady,
          revision: 1,
        },
      });
    };

    const renderSection = async () => {
      render(
        <MemoryRouter initialEntries={["/projects/project-1"]}>
          <OpenItemsProvider
            organizationId="org-1"
            userId={openItemsTestUserId()}
            projectId="project-1"
          >
            <OpenItemsSection organizationId="org-1" projectId="project-1" />
            <CanonicalOpenItemsReady />
          </OpenItemsProvider>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("canonical-open-items-ready"),
        ).toHaveAttribute("data-ready", "true"),
      );
    };

    it("shows the total including nested rows and mirrors it in the toggle label", async () => {
      seedGroup(false, [thinkingId, readyId, idleId]);
      await renderSection();

      const header = screen.getByTestId("open-items-group-header");
      expect(within(header).getByText("Work (4)")).toBeInTheDocument();
      expect(
        within(header).getByRole("button", { name: "Collapse Work (4)" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("open-items-group-active-indicators"),
      ).not.toBeInTheDocument();
    });

    it("shows n/m with Show active only on, counting surviving lineage ancestors", async () => {
      seedGroup(false, [thinkingId, readyId, idleId]);
      await renderSection();

      await act(async () => {
        fireEvent.click(
          screen.getAllByRole("button", { name: "Show active only" })[0]!,
        );
      });

      const header = screen.getByTestId("open-items-group-header");
      // Parent task (ancestor of the thinking session), thinking session and
      // message-ready session remain; the idle session is filtered out.
      expect(within(header).getByText("Work (3/4)")).toBeInTheDocument();
      expect(
        within(header).getByRole("button", { name: "Collapse Work (3/4)" }),
      ).toBeInTheDocument();
    });

    it("shows each active session's indicator, overlapped, only while collapsed", async () => {
      seedGroup(true, [thinkingId, readyId, idleId]);
      await renderSection();

      const indicators = screen.getByTestId(
        "open-items-group-active-indicators",
      );
      expect(
        within(indicators).getByTestId("agent-session-current-state-indicator"),
      ).toHaveAttribute(
        "data-current-state",
        AgentSessionCurrentState.Thinking,
      );
      expect(
        within(indicators).getByTestId(
          "agent-session-output-attention-indicator",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("open-items-group-header")).getByText(
          "Work (4)",
        ),
      ).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId("open-items-group-toggle"));
      });
      expect(
        screen.queryByTestId("open-items-group-active-indicators"),
      ).not.toBeInTheDocument();
    });

    it("shows no indicator for a collapsed group without active sessions", async () => {
      seedGroup(true, [idleId]);
      await renderSection();

      expect(
        within(screen.getByTestId("open-items-group-header")).getByText(
          "Work (2)",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("open-items-group-active-indicators"),
      ).not.toBeInTheDocument();
    });
  });

  it("assigns selected rows and open descendants through the existing group callback", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "071ae9ab-1d93-54f4-89a9-3560d8a088c6",
            entityType: "task",
          },
          {
            entityId: "9d0c1583-d998-5742-bc6b-60627419413d",
            entityType: "task",
            lineage: [
              {
                entityType: "task",
                entityId: "071ae9ab-1d93-54f4-89a9-3560d8a088c6",
              },
            ],
          },
          {
            entityId: "a9d86458-a7cf-5d3a-97eb-c3f38fb386df",
            entityType: "task",
          },
        ],
        groups: [
          {
            id: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
            name: "Focus",
            order: 0,
            collapsed: false,
          },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/unchanged"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <LocationProbe />
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-interaction-071ae9ab-1d93-54f4-89a9-3560d8a088c6",
          ),
        ).getByText("Select items"),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-task-a9d86458-a7cf-5d3a-97eb-c3f38fb386df",
          ),
        ).getByRole("link"),
      );
    });
    await act(async () => {
      fireEvent.contextMenu(
        screen.getByTestId(
          "open-item-interaction-071ae9ab-1d93-54f4-89a9-3560d8a088c6",
        ),
      );
    });
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-interaction-071ae9ab-1d93-54f4-89a9-3560d8a088c6",
          ),
        ).getByText("Assign existing group"),
      );
    });
    await waitFor(() => {
      const stored = readOpenItemsTestCache("project-1");
      expect(
        stored.items.filter(
          (item: { groupId?: string }) =>
            item.groupId === "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
        ),
      ).toHaveLength(3);
    });
    expect(screen.getByTestId("location")).toHaveTextContent("/unchanged");
  });

  it("uses a group header context menu for rename and remove", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "d5aa01f8-da79-5a3c-9def-4d0db14725f0",
            entityType: "task",
            groupId: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
          },
        ],
        groups: [
          {
            id: "d806f4d0-6a42-5bbf-be11-b8d7b03a12bf",
            name: "Focus",
            order: 0,
            collapsed: false,
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.queryByTestId("open-items-group-rename"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("open-items-group-delete"),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId("open-items-group-header"), {
        clientX: 120,
        clientY: 160,
      });
    });
    expect(
      screen.getByTestId("open-items-group-context-rename"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("open-items-group-context-remove"),
    ).toHaveTextContent("Remove Group");

    await act(async () => {
      fireEvent.click(screen.getByTestId("open-items-group-context-rename"));
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Group name"), {
        target: { value: "Renamed" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("open-items-group-rename-save"));
    });
    expect(screen.getByText("Renamed (1)")).toBeInTheDocument();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTestId("open-items-group-header"), {
        clientX: 120,
        clientY: 160,
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("open-items-group-context-remove"));
    });
    expect(
      screen.queryByTestId("open-items-group-header"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-d5aa01f8-da79-5a3c-9def-4d0db14725f0"),
    ).toBeInTheDocument();
  });

  it("toggles the dynamic sort action without changing item metadata", async () => {
    const storedItems = [
      {
        entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        entityType: "task",
        firstAddedOrder: 1,
        pinned: true,
      },
      {
        entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
        entityType: "task",
        firstAddedOrder: 2,
        pinned: true,
      },
      {
        entityId: "ca4dd2f6-d35b-5130-aa34-2e74840afbf7",
        entityType: "task",
        firstAddedOrder: 3,
      },
      {
        entityId: "6df6c145-14e2-51bc-9baa-c2a33c906c05",
        entityType: "task",
        firstAddedOrder: 4,
      },
    ];
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({ version: 1, items: storedItems }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.getAllByRole("button", { name: "Sort by newest" }),
    ).toHaveLength(4);
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Sort by newest" })[0]!,
      );
    });

    expect(
      screen
        .getAllByTestId(/^open-item-task-/)
        .map((element) => element.dataset.testid),
    ).toEqual([
      "open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f",
      "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      "open-item-task-6df6c145-14e2-51bc-9baa-c2a33c906c05",
      "open-item-task-ca4dd2f6-d35b-5130-aa34-2e74840afbf7",
    ]);
    expect(
      screen.getAllByRole("button", { name: "Sort by oldest" }),
    ).toHaveLength(4);
    expect(readOpenItemsTestCache("project-1")).toMatchObject({
      sortDirection: "newest",
      items: storedItems,
    });
  });

  it("opens inline preview without changing the current route", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <RouteActivationProbe />
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

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Preview Investigate preview",
        }),
      );
    });

    expect(openPreviewMock).toHaveBeenCalledTimes(1);
    expect(openPreviewMock).toHaveBeenCalledWith({
      entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      entityType: "task",
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1",
    );
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toBeInTheDocument();
  });

  it("removes an inline open item without navigating or touching recently viewed state", async () => {
    const recentlyViewedRecord = JSON.stringify({
      events: [
        {
          id: "f92326ba-4259-550c-893e-9e11f70c56ee",
          entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        },
      ],
    });
    localStorage.setItem("recently-viewed:test", recentlyViewedRecord);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <RouteActivationProbe />
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

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Remove from Open",
        }),
      );
    });

    expect(
      screen.queryByTestId(
        "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1",
    );
    expect(localStorage.getItem("recently-viewed:test")).toBe(
      recentlyViewedRecord,
    );
  });

  it.each([{ entryPoint: "context menu", buttonName: "Remove from Open" }])(
    "preserves pinned descendants when removing a branch from the $entryPoint control",
    async ({ entryPoint, buttonName }) => {
      localStorage.setItem(
        "open-items:v1:project-1",
        JSON.stringify({
          version: 1,
          items: [
            {
              entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
              entityType: "plan",
            },
            {
              entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
              entityType: "task",
              pinned: true,
              lineage: [
                {
                  entityType: "plan",
                  entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
                },
              ],
            },
            {
              entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
              entityType: "agent_session",
              lineage: [
                {
                  entityType: "plan",
                  entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
                },
                {
                  entityType: "task",
                  entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
                },
              ],
            },
            {
              entityId: "4b59168a-1997-538e-aca6-35808876a2ae",
              entityType: "agent_session",
              pinned: true,
              lineage: [
                {
                  entityType: "plan",
                  entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
                },
                {
                  entityType: "task",
                  entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
                },
              ],
            },
            {
              entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
              entityType: "task",
            },
          ],
        }),
      );

      render(
        <MemoryRouter initialEntries={["/projects/project-1"]}>
          <OpenItemsProvider
            organizationId="org-1"
            userId={openItemsTestUserId()}
            projectId="project-1"
          >
            <OpenItemsSection organizationId="org-1" projectId="project-1" />
            <CanonicalOpenItemsReady />
          </OpenItemsProvider>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("canonical-open-items-ready"),
        ).toHaveAttribute("data-ready", "true"),
      );

      const rootInteraction = await screen.findByTestId(
        "open-item-interaction-8013eea4-4c54-5f6a-ae42-d9188e822bf7",
      );
      const removeButton = within(rootInteraction).getByRole("button", {
        name: buttonName,
      });
      await act(async () => {
        fireEvent.click(removeButton);
      });

      expect(
        screen.queryByTestId(
          "open-item-plan-8013eea4-4c54-5f6a-ae42-d9188e822bf7",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId(
          "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId(
          "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId(
          "open-item-agent_session-4b59168a-1997-538e-aca6-35808876a2ae",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          "open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f",
        ),
      ).toBeInTheDocument();
    },
  );

  it("does not navigate when the active open item is removed", async () => {
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
          },
        ],
      }),
    );
    currentCanonicalPageMock.mockReturnValue(
      createEntityActivation(
        "task",
        "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        null,
      ),
    );

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

    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-interaction-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
          ),
        ).getByRole("button", { name: "Remove from Open" }),
      );
    });

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );
    expect(
      screen.queryByTestId(
        "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toHaveAttribute("data-active", "false");
  });

  it("renders agent-session rows with session titles and canonical routes", async () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: {
        id: "885f5380-2285-5451-af9f-d9a4a474d503",
        title: "Resolve launch blockers",
      },
    } as unknown as ReturnType<typeof useAgentSession>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
            whyOpen: "Check status",
          },
        ],
      }),
    );
    currentCanonicalPageMock.mockReturnValue(
      createEntityActivation(
        "agent_session",
        "885f5380-2285-5451-af9f-d9a4a474d503",
        null,
      ),
    );

    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/sessions/885f5380-2285-5451-af9f-d9a4a474d503",
        ]}
      >
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    const link = await screen.findByRole("link", {
      name: /Resolve launch blockers/,
    });
    expect(link).toHaveAttribute(
      "href",
      "/projects/project-1/sessions/885f5380-2285-5451-af9f-d9a4a474d503",
    );
    expect(link).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByTestId(
        "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
      ),
    ).toBeInTheDocument();
    expect(useAgentSessionMock).not.toHaveBeenCalled();
  });

  it("shows the stored conversation title on an Open Item without detail reads", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
            presentation: {
              kind: "agent_session",
              label: "Updated conversation title",
              sessionType: AgentSessionType.EntityConversation,
              entityConversationRoute: {
                conversationId: "155464cd-7395-55bc-8e6d-8d97a0f13c0c",
                entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
                entityType: "TASK",
              },
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.getByRole("link", { name: /Updated conversation title/ }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/agent-sessions/885f5380-2285-5451-af9f-d9a4a474d503/entity-conversations/155464cd-7395-55bc-8e6d-8d97a0f13c0c?entityId=e8a970e8-3ee8-5d4f-a62e-d273e23779ab&entityType=TASK",
    );
    expect(screen.getByTestId("entity-icon-agent_session")).toHaveAttribute(
      "data-agent-session-type",
      AgentSessionType.EntityConversation,
    );
    expect(useAgentSessionMock).not.toHaveBeenCalled();
    expect(useServiceMock).not.toHaveBeenCalled();
    expect(useConversationMock).not.toHaveBeenCalled();
  });

  it("renders the shared phase icon for restored conversation rows", async () => {
    useConversationPhasesMock.mockReturnValue({
      "155464cd-7395-55bc-8e6d-8d97a0f13c0c": {
        phase: ConversationPhase.Reviewing,
        revision: 1,
        transitionedAt: "2026-08-07T00:00:00.000Z",
      },
    });
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "155464cd-7395-55bc-8e6d-8d97a0f13c0c",
            entityType: "conversation",
            presentation: {
              kind: "conversation",
              label: "Review conversation",
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    expect(useConversationPhasesMock).toHaveBeenCalledWith([
      "155464cd-7395-55bc-8e6d-8d97a0f13c0c",
    ]);
    expect(screen.getByTestId("conversation-phase-indicator")).toHaveAttribute(
      "data-phase",
      ConversationPhase.Reviewing,
    );
  });

  it("renders restored Design Doc titles without detail hooks", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "f60e4e1c-9801-514f-a431-e9e18905dae7",
            entityType: "design_doc",
            presentation: {
              kind: "design_doc",
              label: "Request retry policy",
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      await screen.findByRole("link", { name: /Request retry policy/ }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/design-docs/f60e4e1c-9801-514f-a431-e9e18905dae7",
    );
    expect(useDesignDocMock).not.toHaveBeenCalled();
  });

  it("keeps legacy Design Doc rows fail-closed without detail hydration", async () => {
    preserveMissingPresentation = true;
    useDesignDocMock.mockReturnValue({
      data: {
        id: "f60e4e1c-9801-514f-a431-e9e18905dae7",
        name: "Request retry policy",
      },
    } as unknown as ReturnType<typeof useDesignDoc>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "f60e4e1c-9801-514f-a431-e9e18905dae7",
            entityType: "design_doc",
            whyOpen: "Review this",
            pinned: true,
            firstAddedOrder: 3,
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.queryByTestId(
        "open-item-design_doc-f60e4e1c-9801-514f-a431-e9e18905dae7",
      ),
    ).not.toBeInTheDocument();
    expect(useDesignDocMock).not.toHaveBeenCalled();
  });

  it("restores a coding session's task-scoped canonical route from lineage", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
            lineage: [
              {
                entityType: "task",
                entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
              },
            ],
            presentation: {
              kind: "agent_session",
              label: "API - Fix retries",
              sessionType: AgentSessionType.Coding,
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      await screen.findByRole("link", { name: /API - Fix retries/ }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab/agent-sessions/885f5380-2285-5451-af9f-d9a4a474d503",
    );
    expect(useAgentSessionMock).not.toHaveBeenCalled();
    expect(useServiceMock).not.toHaveBeenCalled();
  });

  it.each([AgentSessionType.Coding, AgentSessionType.EntityConversation])(
    "passes the resolved %s Agent Session type to the shared icon boundary",
    async (type) => {
      useAgentSessionMock.mockReturnValue({
        agentSession: {
          id: "885f5380-2285-5451-af9f-d9a4a474d503",
          title: "Resolve launch blockers",
          type,
        },
      } as unknown as ReturnType<typeof useAgentSession>);
      localStorage.setItem(
        "open-items:v1:project-1",
        JSON.stringify({
          version: 1,
          items: [
            {
              entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
              entityType: "agent_session",
              presentation: {
                kind: "agent_session",
                label: "Resolve launch blockers",
                sessionType: type,
              },
            },
          ],
        }),
      );

      render(
        <MemoryRouter>
          <OpenItemsProvider
            organizationId="org-1"
            userId={openItemsTestUserId()}
            projectId="project-1"
          >
            <OpenItemsSection organizationId="org-1" projectId="project-1" />
            <CanonicalOpenItemsReady />
          </OpenItemsProvider>
        </MemoryRouter>,
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("canonical-open-items-ready"),
        ).toHaveAttribute("data-ready", "true"),
      );

      expect(
        await screen.findByTestId("entity-icon-agent_session"),
      ).toHaveAttribute("data-agent-session-type", type);
    },
  );

  it("opens an agent-session hover card without changing Open Items or navigation", async () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: {
        id: "885f5380-2285-5451-af9f-d9a4a474d503",
        title: "Resolve launch blockers",
      },
    } as unknown as ReturnType<typeof useAgentSession>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
          },
        ],
      }),
    );
    const persistedOpenItems = localStorage.getItem("open-items:v1:project-1");

    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/sessions/885f5380-2285-5451-af9f-d9a4a474d503",
        ]}
      >
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    await act(async () => {
      fireEvent.mouseEnter(
        await screen.findByTestId(
          "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
        ),
      );
    });

    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
    expect(await screen.findByTestId("entity-hover-card")).toHaveTextContent(
      "peek open",
    );
    expect(entityHoverCardMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
        entityType: "agent_session",
        organizationId: "org-1",
        projectId: "project-1",
      }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/sessions/885f5380-2285-5451-af9f-d9a4a474d503",
    );
    expect(localStorage.getItem("open-items:v1:project-1")).toBe(
      persistedOpenItems,
    );
  });

  it("cancels a pending hover card when the pointer leaves before 400 ms", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );

    const view = render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
    vi.useFakeTimers();
    const row = screen.getByTestId(
      "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );

    try {
      await act(async () => {
        fireEvent.mouseEnter(row);
      });
      act(() => vi.advanceTimersByTime(399));
      expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.mouseLeave(row);
      });
      act(() => vi.advanceTimersByTime(500));
      expect(entityHoverCardMock).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("does not open entity or saved-note previews when hover is unavailable", async () => {
    canHoverMock.mockReturnValue(false);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "task",
            whyOpen: "Release blocker",
          },
        ],
      }),
    );

    const view = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/projects/project-1"]}>
          <OpenItemsProvider
            organizationId="org-1"
            userId={openItemsTestUserId()}
            projectId="project-1"
          >
            <OpenItemsSection organizationId="org-1" projectId="project-1" />
            <CanonicalOpenItemsReady />
          </OpenItemsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("canonical-open-items-ready")).toHaveAttribute(
        "data-ready",
        "true",
      ),
    );
    vi.useFakeTimers();

    try {
      await act(async () => {
        fireEvent.mouseEnter(
          screen.getByTestId(
            "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
          ),
        );
        fireEvent.mouseEnter(
          screen.getByTestId(
            "open-item-task-885f5380-2285-5451-af9f-d9a4a474d503",
          ),
        );
      });
      act(() => vi.advanceTimersByTime(500));

      expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(
          "open-item-note-task-885f5380-2285-5451-af9f-d9a4a474d503",
        ),
      ).not.toBeInTheDocument();
      expect(entityHoverCardMock).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("hides Peek while the row menu is open and requires a fresh hover after close", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );
    const view = render(
      <MemoryRouter>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
    vi.useFakeTimers();
    const row = screen.getByTestId(
      "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );
    const interaction = screen.getByTestId(
      "open-item-interaction-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );
    try {
      await act(async () => {
        fireEvent.mouseEnter(row);
      });
      act(() => vi.advanceTimersByTime(200));
      await act(async () => {
        fireEvent.contextMenu(interaction);
      });
      act(() => vi.advanceTimersByTime(500));
      expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(within(interaction).getByText("Close menu"));
      });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.mouseLeave(row);
      });
      await act(async () => {
        fireEvent.mouseEnter(row);
      });
      act(() => vi.advanceTimersByTime(400));
      expect(screen.getByTestId("entity-hover-card")).toBeInTheDocument();
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it("nests a coding session under open plan lineage and uses the launch service label", async () => {
    useWorkItemMock.mockImplementation(
      (_organizationId, _entityType, entityId, options) =>
        ({
          error: null,
          isLoading: false,
          workItem:
            options?.enabled &&
            entityId === "e8a970e8-3ee8-5d4f-a62e-d273e23779ab"
              ? {
                  id: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
                  name: "Import records",
                }
              : null,
        }) as unknown as ReturnType<typeof useWorkItem>,
    );
    usePlanMock.mockImplementation(
      (_organizationId, _projectId, planId, options) =>
        ({
          data:
            options?.enabled &&
            planId === "8013eea4-4c54-5f6a-ae42-d9188e822bf7"
              ? {
                  id: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
                  title: "Ship importer",
                }
              : undefined,
        }) as ReturnType<typeof usePlan>,
    );
    useAgentSessionMock.mockImplementation(
      (_organizationId, _projectId, sessionId, options) =>
        ({
          agentSession:
            options?.enabled &&
            sessionId === "885f5380-2285-5451-af9f-d9a4a474d503"
              ? {
                  id: "885f5380-2285-5451-af9f-d9a4a474d503",
                  title: "Resolve launch blockers",
                  launchServiceId: "service-launch",
                  service: { id: "service-linked", name: "Linked service" },
                }
              : null,
        }) as unknown as ReturnType<typeof useAgentSession>,
    );
    useServiceMock.mockImplementation(
      (_organizationId, serviceId, options) =>
        ({
          data:
            options?.enabled && serviceId === "service-launch"
              ? { id: "service-launch", name: "Launch API" }
              : undefined,
        }) as ReturnType<typeof useService>,
    );
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
            lineage: buildAgentSessionNavigationLineage({
              routeFamily: "plan",
              planId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
              stageId: "2f04f098-401f-5a69-9a62-0a25b49092cd",
              stepId: "6edfaa9b-06ce-51a1-adf2-b3a7818ccc98",
              taskId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            }),
            presentation: {
              kind: "agent_session",
              label: "Launch API - Resolve launch blockers",
              sessionType: AgentSessionType.Coding,
            },
          },
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            lineage: [
              {
                entityType: "task",
                entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
              },
              {
                entityType: "task",
                entityId: "2f04f098-401f-5a69-9a62-0a25b49092cd",
              },
              {
                entityType: "task",
                entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
              },
            ],
            presentation: {
              kind: "task",
              label: "Import records",
              taskType: "STANDARD",
            },
          },
          {
            entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
            entityType: "task",
            presentation: {
              kind: "task",
              taskType: "PLAN",
              label: "Ship importer",
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/sessions/885f5380-2285-5451-af9f-d9a4a474d503",
        ]}
      >
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      screen.getByTestId("open-item-task-8013eea4-4c54-5f6a-ae42-d9188e822bf7"),
    ).toHaveAttribute("data-depth", "0");
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toHaveAttribute("data-depth", "1");
    expect(
      screen.getByTestId(
        "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
      ),
    ).toHaveAttribute("data-depth", "2");
    expect(
      screen.getByRole("link", {
        name: /Launch API - Resolve launch blockers/,
      }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab/agent-sessions/885f5380-2285-5451-af9f-d9a4a474d503",
    );
    expect(
      screen.getByRole("link", { name: /Import records/ }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );
    expect(screen.getByText("OPEN (3)")).toBeInTheDocument();
    expect(useWorkItemMock).not.toHaveBeenCalled();
    expect(useAgentSessionMock).not.toHaveBeenCalled();
    expect(usePlanMock).not.toHaveBeenCalled();
    expect(useServiceMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(
            "open-item-interaction-8013eea4-4c54-5f6a-ae42-d9188e822bf7",
          ),
        ).getByRole("button", { name: "Remove from Open" }),
      );
    });

    expect(
      screen.queryByTestId(
        "open-item-plan-8013eea4-4c54-5f6a-ae42-d9188e822bf7",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("OPEN (0)")).toBeInTheDocument();
  });

  it("resolves an entity-conversation session to its canonical conversation route", async () => {
    useAgentSessionMock.mockReturnValue({
      agentSession: {
        id: "885f5380-2285-5451-af9f-d9a4a474d503",
        title: "Plan discussion",
        type: AgentSessionType.EntityConversation,
        conversationId: "155464cd-7395-55bc-8e6d-8d97a0f13c0c",
        entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
        entityType: EntityType.Task,
      },
    } as unknown as ReturnType<typeof useAgentSession>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
            entityType: "agent_session",
            lineage: buildAgentSessionNavigationLineage({
              routeFamily: "plan",
              planId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
            }),
            presentation: {
              kind: "agent_session",
              label: "Plan discussion",
              sessionType: AgentSessionType.EntityConversation,
              entityConversationRoute: {
                conversationId: "155464cd-7395-55bc-8e6d-8d97a0f13c0c",
                entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
                entityType: EntityType.Task,
              },
            },
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    const sessionLink = await screen.findByRole("link", {
      name: /Plan discussion/,
    });
    expect(sessionLink).toHaveAttribute(
      "href",
      "/projects/project-1/agent-sessions/885f5380-2285-5451-af9f-d9a4a474d503/entity-conversations/155464cd-7395-55bc-8e6d-8d97a0f13c0c?entityId=8013eea4-4c54-5f6a-ae42-d9188e822bf7&entityType=TASK",
    );
    await act(async () => {
      fireEvent.click(sessionLink);
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/agent-sessions/885f5380-2285-5451-af9f-d9a4a474d503/entity-conversations/155464cd-7395-55bc-8e6d-8d97a0f13c0c?entityId=8013eea4-4c54-5f6a-ae42-d9188e822bf7&entityType=TASK",
    );
    const stored = JSON.parse(
      JSON.stringify(readOpenItemsTestCache("project-1")),
    );
    expect(stored.items[0].presentation).toEqual({
      kind: "agent_session",
      label: "Plan discussion",
      sessionType: AgentSessionType.EntityConversation,
      entityConversationRoute: {
        conversationId: "155464cd-7395-55bc-8e6d-8d97a0f13c0c",
        entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
        entityType: EntityType.Task,
      },
    });
    expect(stored.items[0].lineage).toEqual([
      { entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7", entityType: "task" },
    ]);
    expect(useAgentSessionMock).not.toHaveBeenCalled();
  });

  it("renders plan rows with their persisted titles instead of the plan fallback", async () => {
    usePlanMock.mockReturnValue({
      data: {
        id: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
        title: "Ship the importer",
      },
    } as ReturnType<typeof usePlan>);
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
            entityType: "plan",
          },
        ],
      }),
    );

    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/plans/8013eea4-4c54-5f6a-ae42-d9188e822bf7",
        ]}
      >
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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
      await screen.findByRole("link", { name: /Ship the importer/ }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/plans/8013eea4-4c54-5f6a-ae42-d9188e822bf7",
    );
    expect(
      screen.getByRole("button", { name: "Preview Ship the importer" }),
    ).toBeInTheDocument();
    expect(usePlanMock).not.toHaveBeenCalled();
  });

  it("opens an in-app note modal without calling window.prompt", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <RouteActivationProbe />
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

    const prompt = vi.spyOn(window, "prompt");
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Add note" }));
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Note for Investigate preview" }),
    ).toBeInTheDocument();

    const noteField = screen.getByRole("textbox", { name: "Note" });
    await act(async () => {
      fireEvent.change(noteField, { target: { value: "Release blocker" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Note for Investigate preview" }),
      ).not.toBeInTheDocument();
    });
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).toContain(
      "Release blocker",
    );
    expect(
      screen.getByRole("button", { name: "Edit note" }),
    ).toBeInTheDocument();
  });

  it("renders saved notes on hover instead of Peek", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            whyOpen: "Release blocker",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <RouteActivationProbe />
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

    await act(async () => {
      fireEvent.mouseEnter(
        await screen.findByTestId(
          "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        ),
      );
    });

    expect(
      await screen.findByTestId(
        "open-item-note-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).toHaveTextContent("Release blocker");
    expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
  });

  it("keeps standard Peek hover rendering when no note exists", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <RouteActivationProbe />
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

    await act(async () => {
      fireEvent.mouseEnter(
        await screen.findByTestId(
          "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        ),
      );
    });

    expect(await screen.findByTestId("entity-hover-card")).toHaveTextContent(
      "peek open",
    );
    expect(
      screen.queryByTestId(
        "open-item-note-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
  });

  it("removes the saved note with the open item", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            whyOpen: "Release blocker",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
          <RouteActivationProbe />
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove from Open" }));
    });
    expect(
      screen.queryByTestId(
        "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).not.toContain(
      "Release blocker",
    );
  });

  it("supplies visible-order bulk removal actions", async () => {
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({
        version: 1,
        items: [
          {
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
            entityType: "task",
            whyOpen: "d5a0df60-b244-586a-911a-19b510019a5b",
          },
          {
            entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
            entityType: "task",
            whyOpen: "1307cde2-d3e5-5c9a-97d4-d6f946f47664",
          },
          {
            entityId: "ca4dd2f6-d35b-5130-aa34-2e74840afbf7",
            entityType: "task",
            whyOpen: "68e459fa-604a-5ac2-b28a-78602423f2de",
          },
        ],
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <OpenItemsSection organizationId="org-1" projectId="project-1" />
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

    await screen.findByTestId(
      "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );
    const removeAboveButtons = screen.getAllByRole("button", {
      name: "Remove All Above",
    });
    expect(removeAboveButtons[0]).toBeDisabled();
    expect(removeAboveButtons[1]).toBeEnabled();
    expect(removeAboveButtons[2]).toBeEnabled();

    await act(async () => {
      fireEvent.click(removeAboveButtons[1]);
    });

    expect(
      screen.queryByTestId(
        "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-ca4dd2f6-d35b-5130-aa34-2e74840afbf7"),
    ).toBeInTheDocument();
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).not.toContain(
      "d5a0df60-b244-586a-911a-19b510019a5b",
    );
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).toContain(
      "1307cde2-d3e5-5c9a-97d4-d6f946f47664",
    );
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).toContain(
      "68e459fa-604a-5ac2-b28a-78602423f2de",
    );

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "Remove Others" })[0],
      );
    });
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-task-ca4dd2f6-d35b-5130-aa34-2e74840afbf7",
      ),
    ).not.toBeInTheDocument();
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).not.toContain(
      "68e459fa-604a-5ac2-b28a-78602423f2de",
    );
    expect(JSON.stringify(readOpenItemsTestCache("project-1"))).toContain(
      "1307cde2-d3e5-5c9a-97d4-d6f946f47664",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove All" }));
    });
    expect(
      screen.queryByTestId(
        "open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f",
      ),
    ).not.toBeInTheDocument();
    expect(readOpenItemsTestCache("project-1")).toMatchObject({
      version: 1,
      items: [],
    });
  });

  it("bounds mounted row work for 200 mixed nested items", async () => {
    const fixtureId = (index: number) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    compactInteractionMock.mockReturnValue(true);
    const entityTypes = [
      "task",
      "goal",
      "agent_session",
      "plan",
      "initiative",
      "conversation",
      "design_doc",
      "proposal",
    ] as const;
    const items = Array.from({ length: 200 }, (_, index) => {
      const entityType = entityTypes[index % entityTypes.length]!;
      const group = Math.floor(index / entityTypes.length);
      return {
        entityId: fixtureId(index),
        entityType,
        firstAddedOrder: index + 1,
        ...(group % 2 === 0 ? { pinned: true } : {}),
        ...(entityType === "agent_session"
          ? {
              lineage: buildAgentSessionNavigationLineage({
                routeFamily: "task",
                taskId: fixtureId(group * entityTypes.length),
              }),
            }
          : {}),
      };
    });
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({ version: 1, items }),
    );

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <OpenItemsProvider
          organizationId="org-1"
          userId={openItemsTestUserId()}
          projectId="project-1"
        >
          <SectionRerenderHarness />
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

    await screen.findByTestId(`open-item-task-${fixtureId(0)}`);
    const initialRowRenderCount = openItemInteractionMock.mock.calls.length;
    const initialDragHookCount = entityDragSourceMock.mock.calls.length;
    const dragAttachmentCount = () =>
      new Set(
        entityDragSourceMock.mock.results.flatMap(({ value }) =>
          value.setNodeRef.mock.calls
            .map(([node]: [HTMLElement | null]) => node)
            .filter((node): node is HTMLElement => node instanceof HTMLElement),
        ),
      ).size;
    expect(initialRowRenderCount).toBeGreaterThanOrEqual(200);
    expect(initialRowRenderCount % 200).toBe(0);
    expect(initialDragHookCount).toBe(initialRowRenderCount);
    expect(dragAttachmentCount()).toBe(200);
    expect(
      openItemInteractionMock.mock.calls.every(
        ([props]) =>
          props.draggable === false &&
          props.organizationId === "org-1" &&
          props.projectId === "project-1",
      ),
    ).toBe(true);
    expect(useWorkItemMock).not.toHaveBeenCalled();
    expect(useAgentSessionMock).not.toHaveBeenCalled();
    expect(usePlanMock).not.toHaveBeenCalled();
    expect(useDesignDocMock).not.toHaveBeenCalled();
    expect(useServiceMock).not.toHaveBeenCalled();
    expect(useWorkItemTypesMock).toHaveBeenCalled();
    expect(entityHoverCardMock).not.toHaveBeenCalled();

    const initialOrder = [
      ...document.querySelectorAll<HTMLElement>("[data-depth]"),
    ].map((row) => row.dataset.testid);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Rerender section parent" }),
      );
    });
    expect(screen.getByTestId("section-parent-render-count")).toHaveTextContent(
      "1",
    );
    expect(openItemInteractionMock).toHaveBeenCalledTimes(
      initialRowRenderCount,
    );
    expect(entityDragSourceMock).toHaveBeenCalledTimes(initialDragHookCount);

    const hoveredRow = screen.getByTestId(`open-item-task-${fixtureId(0)}`);
    await act(async () => {
      fireEvent.mouseEnter(hoveredRow);
    });
    expect(await screen.findByTestId("entity-hover-card")).toBeInTheDocument();
    expect(entityHoverCardMock).toHaveBeenCalled();
    await act(async () => {
      fireEvent.mouseLeave(hoveredRow);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("entity-hover-card")).not.toBeInTheDocument();
    });
    await waitFor(() => expect(entityHoverCardUnmountMock).toHaveBeenCalled());

    const rowRenderCountBeforeCollapse =
      openItemInteractionMock.mock.calls.length;
    const dragHookCountBeforeCollapse = entityDragSourceMock.mock.calls.length;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Collapse open" }));
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId(`open-item-task-${fixtureId(0)}`),
      ).not.toBeInTheDocument();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Expand open" }));
    });
    await screen.findByTestId(`open-item-task-${fixtureId(0)}`);

    expect(entityDragSourceMock).toHaveBeenCalledTimes(
      dragHookCountBeforeCollapse + 200,
    );
    expect(openItemInteractionMock).toHaveBeenCalledTimes(
      rowRenderCountBeforeCollapse + 200,
    );
    expect(dragAttachmentCount()).toBe(400);
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-depth]")].map(
        (row) => row.dataset.testid,
      ),
    ).toEqual(initialOrder);
  }, 15_000);

  it("offers disclosure controls for feature and task branches without mutating open items", async () => {
    const storedItems = [
      {
        entityId: "e8fcc19c-6e24-5444-8754-216f56ad8ca6",
        entityType: "task",
        firstAddedOrder: 1,
        presentation: {
          kind: "task",
          label: "Feature root",
          taskType: "FEATURE",
        },
      },
      {
        entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        entityType: "task",
        firstAddedOrder: 2,
        lineage: [
          {
            entityType: "task",
            entityId: "e8fcc19c-6e24-5444-8754-216f56ad8ca6",
          },
        ],
        presentation: {
          kind: "task",
          label: "Task 9d0c1583-d998-5742-bc6b-60627419413d",
          taskType: "STANDARD",
        },
      },
      {
        entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
        entityType: "agent_session",
        firstAddedOrder: 3,
        lineage: [
          {
            entityType: "task",
            entityId: "e8fcc19c-6e24-5444-8754-216f56ad8ca6",
          },
          {
            entityType: "task",
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
          },
        ],
        presentation: {
          kind: "agent_session",
          label: "Session 9d0c1583-d998-5742-bc6b-60627419413d",
          sessionType: AgentSessionType.Coding,
        },
      },
      {
        entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
        entityType: "task",
        firstAddedOrder: 4,
        presentation: {
          kind: "task",
          label: "Separate root",
          taskType: "STANDARD",
        },
      },
    ];
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({ version: 1, items: storedItems }),
    );
    currentCanonicalPageMock.mockReturnValue(
      createEntityActivation(
        "task",
        "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        null,
      ),
    );

    const user = userEvent.setup();
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

    const featureToggle = await screen.findByRole("button", {
      name: "Collapse Feature root",
    });
    const taskToggle = screen.getByRole("button", {
      name: "Collapse Task 9d0c1583-d998-5742-bc6b-60627419413d",
    });
    expect(featureToggle).toHaveAttribute("aria-expanded", "true");
    expect(taskToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.queryByTestId(
        "open-item-toggle-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toHaveAttribute("data-active", "true");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );

    await act(async () => {
      await user.click(taskToggle);
    });

    expect(
      screen.getByRole("button", {
        name: "Expand Task 9d0c1583-d998-5742-bc6b-60627419413d",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByTestId("open-item-task-e8fcc19c-6e24-5444-8754-216f56ad8ca6"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
      ),
    ).not.toBeInTheDocument();
    expect(readOpenItemsTestCache("project-1").disclosure).toMatchObject({
      version: 1,
      sectionExpanded: true,
      collapsedBranchKeys: ["task:e8a970e8-3ee8-5d4f-a62e-d273e23779ab"],
    });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
    );

    await act(async () => {
      await user.click(featureToggle);
    });

    expect(
      screen.getByRole("button", { name: "Expand Feature root" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByTestId("open-item-task-e8fcc19c-6e24-5444-8754-216f56ad8ca6"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toBeInTheDocument();
    expect(readOpenItemsTestCache("project-1").disclosure).toMatchObject({
      version: 1,
      sectionExpanded: true,
      collapsedBranchKeys: expect.arrayContaining([
        "task:e8fcc19c-6e24-5444-8754-216f56ad8ca6",
        "task:e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
      ]),
    });

    await act(async () => {
      await user.click(
        screen.getByRole("button", { name: "Expand Feature root" }),
      );
    });
    expect(
      screen.getByRole("button", {
        name: "Expand Task 9d0c1583-d998-5742-bc6b-60627419413d",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByTestId("open-item-task-bbc04762-4810-53b6-a5a9-7075c179551f"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
      ),
    ).not.toBeInTheDocument();

    await act(async () => {
      await user.click(
        screen.getByRole("button", {
          name: "Expand Task 9d0c1583-d998-5742-bc6b-60627419413d",
        }),
      );
    });
    expect(
      await screen.findByTestId(
        "open-item-agent_session-885f5380-2285-5451-af9f-d9a4a474d503",
      ),
    ).toBeInTheDocument();
    expect(readOpenItemsTestCache("project-1").disclosure).toMatchObject({
      version: 1,
      sectionExpanded: true,
      collapsedBranchKeys: [],
    });
  });

  it("exposes keyboard disclosure state and restores the same projection after remount", async () => {
    const storedItems = [
      {
        entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
        entityType: "plan",
        firstAddedOrder: 1,
        pinned: true,
      },
      {
        entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        entityType: "task",
        firstAddedOrder: 2,
        lineage: [
          {
            entityType: "plan",
            entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
          },
        ],
      },
      {
        entityId: "885f5380-2285-5451-af9f-d9a4a474d503",
        entityType: "agent_session",
        firstAddedOrder: 3,
        lineage: [
          {
            entityType: "plan",
            entityId: "8013eea4-4c54-5f6a-ae42-d9188e822bf7",
          },
          {
            entityType: "task",
            entityId: "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
          },
        ],
      },
      {
        entityId: "bbc04762-4810-53b6-a5a9-7075c179551f",
        entityType: "task",
        firstAddedOrder: 4,
      },
    ];
    localStorage.setItem(
      "open-items:v1:project-1",
      JSON.stringify({ version: 1, items: storedItems }),
    );
    currentCanonicalPageMock.mockReturnValue(
      createEntityActivation(
        "task",
        "e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        null,
      ),
    );

    const user = userEvent.setup();
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

    const toggle = screen.getByRole("button", { name: "Collapse open" });
    const initialOrder = [
      ...document.querySelectorAll<HTMLElement>("[data-depth]"),
    ].map((row) => row.dataset.testid);
    const initialInteractionCount = openItemInteractionMock.mock.calls.length;

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "open-items-row-tree");
    expect(screen.getByTestId("open-items-row-tree")).toBeInTheDocument();
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toHaveAttribute("data-active", "true");

    act(() => toggle.focus());
    await act(async () => {
      await user.keyboard("{Enter}");
    });

    expect(screen.getByRole("button", { name: "Expand open" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("OPEN (4)")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByTestId("open-items-row-tree"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId(
          "open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab",
        ),
      ).not.toBeInTheDocument();
    });
    expect(readOpenItemsTestCache("project-1").disclosure).toMatchObject({
      version: 1,
      sectionExpanded: false,
      collapsedBranchKeys: [],
    });
    expect(openItemInteractionMock).toHaveBeenCalledTimes(
      initialInteractionCount,
    );

    const expandToggle = screen.getByRole("button", { name: "Expand open" });
    act(() => expandToggle.focus());
    await act(async () => {
      await user.keyboard(" ");
    });

    expect(
      screen.getByRole("button", { name: "Collapse open" }),
    ).toHaveAttribute("aria-expanded", "true");
    await screen.findByTestId("open-items-row-tree");
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-depth]")].map(
        (row) => row.dataset.testid,
      ),
    ).toEqual(initialOrder);
    expect(
      screen.getByTestId("open-item-task-e8a970e8-3ee8-5d4f-a62e-d273e23779ab"),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByTestId(
        "open-item-pinned-indicator-plan-8013eea4-4c54-5f6a-ae42-d9188e822bf7",
      ),
    ).toBeInTheDocument();
    expect(readOpenItemsTestCache("project-1").disclosure).toMatchObject({
      version: 1,
      sectionExpanded: true,
      collapsedBranchKeys: [],
    });
    expect(openItemInteractionMock).toHaveBeenCalledTimes(
      initialInteractionCount + storedItems.length,
    );
  });
});

function CanonicalOpenItemsReady() {
  const { isLoading, isFetching, pending } = useOpenItems();
  expect(screen.queryByTestId("open-items-move-up")).not.toBeInTheDocument();
  expect(screen.queryByTestId("open-items-move-down")).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("open-items-sync-status"),
  ).not.toBeInTheDocument();
  expect(screen.queryByTestId("open-items-refresh")).not.toBeInTheDocument();
  return (
    <span
      hidden
      data-testid="canonical-open-items-ready"
      data-ready={!isLoading && !isFetching && pending === 0}
    />
  );
}
