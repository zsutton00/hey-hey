import type { PlanWorkItem } from "@hey-hey/ui-common/data";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FeatureTag,
  TargetEntityType,
  TaskSource,
  WorkItemTypeRole,
  WorkStatus,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  FEATURE_TAG_PALETTE,
  FEATURE_TAG_VALUES,
  type FeatureTagSelectorProps,
} from "@hey-hey/ui-common/components";

import { buildFeaturePageFixture } from "../Project/help/demos/featurePageFixture";

const {
  createCanonicalPageDescriptorSpy,
  dataDebugTabSpy,
  entityFiltersSpy,
  featureTagSelectorSpy,
  featureTreePresentationReadySpy,
  featureTreeVisualizationSpy,
  interactionComponentSpy,
  workItemReadViewSpy,
} = vi.hoisted(() => ({
  createCanonicalPageDescriptorSpy: vi.fn(),
  dataDebugTabSpy: vi.fn<(props: unknown) => void>(),
  entityFiltersSpy: vi.fn<(props: unknown) => void>(),
  featureTagSelectorSpy: vi.fn<(props: FeatureTagSelectorProps) => void>(),
  featureTreePresentationReadySpy: vi.fn(() => true),
  featureTreeVisualizationSpy: vi.fn<(props: unknown) => void>(),
  interactionComponentSpy: vi.fn(),
  workItemReadViewSpy: vi.fn<(props: unknown) => void>(),
}));

interface MockInteractionComponentProps {
  children: React.ReactNode;
  disablePreview?: boolean;
  entityId?: string;
  entityType?: string;
  entityTitle?: string;
}

vi.mock("@hey-hey/ui-common", () => ({
  createCanonicalPageDescriptor: (
    entityType: string,
    entityId: string,
    lineage: unknown,
  ) => ({ entityType, entityId, lineage }),
  createNavigationLineageEntry: (entityType: string, entityId: string) => ({
    entityType,
    entityId,
  }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({}));
vi.mock("../../components/Plans/CreateFeaturePlanButton", () => ({
  CreateFeaturePlanButton: ({ featureId }: { featureId: string }) => (
    <button data-feature-id={featureId}>Create Plan</button>
  ),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  createCanonicalPageDescriptor: (
    entityType: string,
    entityId: string,
    lineage: unknown,
    presentation: unknown,
  ) => {
    createCanonicalPageDescriptorSpy(
      entityType,
      entityId,
      lineage,
      presentation,
    );
    return { entityType, entityId, lineage, presentation };
  },
  TrackingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    feature: () => "/features/demo",
  },
}));

vi.mock("@hey-hey/ui-common/utils", () => ({
  getTaskContentFromSections: () => ({
    description: "",
    acceptanceCriteria: "",
  }),
}));

vi.mock("@hey-hey/ui-common/feature-tree-visualization", () => ({
  default: (props: unknown) => {
    featureTreeVisualizationSpy(props);
    return (
      <div data-testid="feature-tree-visualization">
        {featureTreePresentationReadySpy() ? (
          <div data-testid="feature-tree-ready">tree</div>
        ) : (
          <div data-testid="feature-tree-loading-card">loading</div>
        )}
      </div>
    );
  },
}));

vi.mock("@hey-hey/ui-common/components", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/components")
  >("@hey-hey/ui-common/components");

  return {
    ...actual,
    CapsuleAction: () => null,
    DiscussCapsuleAction: () => null,
    DiscussModal: () => null,
    EntityFilters: (props: unknown) => {
      entityFiltersSpy(props);
      return <div data-testid="entity-filters" />;
    },
    EntityGrid: ({
      items,
      renderItem,
      showCreateButton,
      onCreateItem,
      createButtonLabel,
    }: {
      items?: TaskResponseDto[];
      renderItem?: (item: TaskResponseDto) => React.ReactNode;
      showCreateButton?: boolean;
      onCreateItem?: () => void;
      createButtonLabel?: string;
    }) => (
      <div data-testid="entity-grid">
        {showCreateButton && (
          <button
            type="button"
            data-testid="entity-grid-create-button"
            onClick={onCreateItem}
          >
            {createButtonLabel}
          </button>
        )}
        {items?.map((item) => (
          <React.Fragment key={item.id}>{renderItem?.(item)}</React.Fragment>
        ))}
      </div>
    ),
    EntityListItem: () => null,
    InteractionComponent: (props: MockInteractionComponentProps) => {
      interactionComponentSpy(props);
      return <>{props.children}</>;
    },
    NewFeatureModal: () => null,
    PlanList: ({
      plans,
      emptyMessage,
      isLoading,
    }: {
      plans: PlanWorkItem[];
      emptyMessage?: string;
      isLoading?: boolean;
    }) => {
      if (isLoading) return <div data-testid="feature-plans-loading" />;
      if (plans.length === 0) return <div>{emptyMessage}</div>;
      return (
        <div>
          {plans.map((p) => (
            <a
              key={p.id}
              data-testid={`feature-plan-link-${p.id}`}
              href={`/projects/proj-1/plans/${p.id}`}
            >
              {p.name}
            </a>
          ))}
        </div>
      );
    },
    taskAdapter: {
      toEntityListItemProps: vi.fn(() => ({ title: "item" })),
    },
    WorkItemEditor: () => <div data-testid="work-item-editor" />,
    WorkItemReadView: (props: unknown) => {
      workItemReadViewSpy(props);
      return <div data-testid="work-item-read-view" />;
    },
    WorkItemEntityFilters: () => <div data-testid="work-item-entity-filters" />,
    useFilteredWorkItems: <T,>(items: T[]) => items,
    FeatureTagSelector: (props: FeatureTagSelectorProps) => {
      featureTagSelectorSpy(props);
      return (
        <div data-testid="feature-tag-selector">
          <span data-testid="feature-tag-value">
            {props.value ?? "__unset__"}
          </span>
          {actual.FEATURE_TAG_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              data-testid={`feature-tag-option-${value}`}
              disabled={!!props.disabled}
              onClick={() => props.onChange(value)}
            >
              {actual.FEATURE_TAG_PALETTE[value].label}
            </button>
          ))}
        </div>
      );
    },
  };
});

vi.mock("../Task/SetReadyActionCapsule", () => ({
  SetReadyActionCapsule: () => null,
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageHeader: ({
    title,
    metadataComponent,
  }: {
    title: React.ReactNode;
    metadataComponent?: React.ReactNode;
  }) => (
    <header>
      <div data-testid="header-title">{title}</div>
      <div data-testid="header-metadata">{metadataComponent}</div>
    </header>
  ),
  DetailPageTabs: ({
    tabs,
  }: {
    tabs: Array<{ value: string; label: string }>;
  }) => (
    <div data-testid="detail-page-tabs">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" data-tab-value={tab.value}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
  DetailPageBody: ({
    content,
    sidebar,
  }: {
    content?: React.ReactNode;
    sidebar?: React.ReactNode;
  }) => (
    <div>
      <div data-testid="detail-page-body-content">{content}</div>
      <div data-testid="detail-page-body-sidebar">{sidebar}</div>
    </div>
  ),
}));

vi.mock("../../components/ContextRailCards", () => ({
  ContextRailCards: ({
    dataTestIdPrefix,
    relatedLoading,
  }: {
    dataTestIdPrefix: string;
    relatedLoading?: boolean;
  }) => (
    <>
      {["history-card", "related-card"].map((card) => {
        const testId = `${dataTestIdPrefix}-${card}`;
        const loading = card === "related-card" && relatedLoading;
        return (
          <div key={card} data-testid={testId} data-loading={String(loading)}>
            {loading ? (
              <div data-testid={`${testId}-loading-progress`} />
            ) : (
              <div data-testid={`${testId}-content-state`} />
            )}
          </div>
        );
      })}
    </>
  ),
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: () => <div data-testid="admin-tab" />,
  buildAdminMetadataItems: () => [],
}));

vi.mock("../../components/Tabs/ConversationListTab", () => ({
  ConversationListTab: () => null,
}));

vi.mock("../../components/Tabs/DataDebugTab", () => ({
  DataDebugTab: (props: unknown) => {
    dataDebugTabSpy(props);
    return <div data-testid="feature-data-debug-tab" />;
  },
}));

vi.mock("../../components/Tabs/DesignDocsTab", () => ({
  DesignDocsTab: () => null,
}));

vi.mock("../../components/TaskBreadcrumbs", () => ({
  TaskBreadcrumbs: () => null,
}));

vi.mock("../../components/Tasks", () => ({
  NewTaskModal: () => null,
}));

import { FeaturePageView } from "./FeaturePageView";

const TASK_BASE: TaskResponseDto = {
  id: "feat-1",
  name: "Authentication",
  type: WORK_ITEM_TYPE_KEYS.Feature,
  organizationId: "org-1",
  projectId: "proj-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  designDocCount: 0,
  codingSessionCount: 0,
  agentSessionCount: 0,
  childCounts: { total: 0, done: 0, inProgress: 0, backlog: 0 },
  sections: [],
};

const renderView = (
  overrides: Parameters<typeof buildFeaturePageFixture>[1],
) => {
  const props = buildFeaturePageFixture(undefined, overrides);
  return render(
    <MemoryRouter>
      <FeaturePageView {...props} />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  createCanonicalPageDescriptorSpy.mockClear();
  dataDebugTabSpy.mockClear();
  entityFiltersSpy.mockClear();
  featureTagSelectorSpy.mockClear();
  featureTreePresentationReadySpy.mockReset();
  featureTreePresentationReadySpy.mockReturnValue(true);
  featureTreeVisualizationSpy.mockClear();
  interactionComponentSpy.mockClear();
  workItemReadViewSpy.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("FeaturePageView feature tag selector", () => {
  it("keeps the title draft local until blur commits the complete value", () => {
    const onTitleChange = vi.fn<(newTitle: string) => Promise<void>>();

    renderView({
      task: TASK_BASE,
      isEditing: true,
      onTitleChange,
    });

    const titleInput = screen.getByRole("textbox");
    fireEvent.change(titleInput, {
      target: { value: "Page Loading Helper" },
    });

    expect(titleInput).toHaveValue("Page Loading Helper");
    expect(onTitleChange).not.toHaveBeenCalled();

    fireEvent.blur(titleInput);

    expect(onTitleChange).toHaveBeenCalledOnce();
    expect(onTitleChange).toHaveBeenCalledWith("Page Loading Helper");
  });

  it("publishes the loaded feature name and authoritative work-item type", () => {
    renderView({
      task: TASK_BASE,
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
    });

    expect(createCanonicalPageDescriptorSpy).toHaveBeenCalledWith(
      "task",
      TASK_BASE.id,
      [{ entityType: "task", entityId: TASK_BASE.id }],
      {
        kind: "task",
        label: TASK_BASE.name,
        taskType: WORK_ITEM_TYPE_KEYS.Feature,
      },
    );
  });

  it("renders FeatureTagSelector with the task's tag in the header metadata slot", () => {
    renderView({
      task: { ...TASK_BASE, tag: FeatureTag.Frontend },
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
    });

    const metadataSlot = screen.getByTestId("header-metadata");
    expect(metadataSlot).toContainElement(
      screen.getByTestId("feature-tag-selector"),
    );
    expect(screen.getByTestId("feature-tag-value")).toHaveTextContent(
      FeatureTag.Frontend,
    );

    expect(featureTagSelectorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        value: FeatureTag.Frontend,
        disabled: false,
      }),
    );
  });

  it("passes a null tag through when the task has no tag set", () => {
    renderView({
      task: { ...TASK_BASE, tag: undefined },
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
    });

    expect(screen.getByTestId("feature-tag-value")).toHaveTextContent(
      "__unset__",
    );
    const lastCall = featureTagSelectorSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.value).toBeUndefined();
  });

  it("renders an option for every FeatureTag value and forwards onChange", () => {
    const onTagChanged = vi.fn();
    renderView({
      task: { ...TASK_BASE, tag: FeatureTag.Frontend },
      onTagChanged,
    });

    for (const value of FEATURE_TAG_VALUES) {
      const option = screen.getByTestId(`feature-tag-option-${value}`);
      expect(option).toBeInTheDocument();
      expect(option).toHaveTextContent(FEATURE_TAG_PALETTE[value].label);
    }

    fireEvent.click(
      screen.getByTestId(`feature-tag-option-${FeatureTag.Backend}`),
    );
    expect(onTagChanged).toHaveBeenCalledWith(FeatureTag.Backend);
  });

  it("disables the selector while the feature is refining", () => {
    renderView({
      task: { ...TASK_BASE, tag: FeatureTag.Frontend },
      isRefining: true,
    });

    const lastCall = featureTagSelectorSpy.mock.calls.at(-1)?.[0];
    expect(lastCall?.disabled).toBe(true);
  });
});

describe("FeaturePageView structured requirements", () => {
  it("passes canonical sections to the shared read view without a projection prop", () => {
    const requirementsSection = {
      id: "section-requirements",
      key: "requirements",
      order: 0,
      materializedMarkdown: JSON.stringify({
        records: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            statement: "Users can sign in.",
            designedBy: [],
            fulfilledBy: [],
            contracts: [],
          },
        ],
      }),
      materializedProposalId: "proposal-1",
    };
    const task = {
      ...TASK_BASE,
      sections: [requirementsSection],
    };
    const featureDefinition: WorkItemTypeDefinitionDto = {
      key: WORK_ITEM_TYPE_KEYS.Feature,
      name: "Feature",
      role: WorkItemTypeRole.ProjectInfo,
      sections: [
        {
          key: "requirements",
          label: "Requirements",
          kind: "json",
          schemaRef: "#/components/schemas/FeatureRequirementsSection",
        },
      ],
      allowedStatuses: [],
    };

    renderView({
      task,
      workItemTypeDefinition: featureDefinition,
      workItemSectionSelection: {
        status: "resolved",
        typeKey: WORK_ITEM_TYPE_KEYS.Feature,
        sections: featureDefinition.sections,
      },
    });

    expect(workItemReadViewSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sections: task.sections }),
    );
  });

  it("shows every requirement without a preview limit", () => {
    renderView({ task: TASK_BASE });

    const props = workItemReadViewSpy.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(props).not.toHaveProperty("requirementsPreview");
  });
});

describe("FeaturePageView interaction boundaries", () => {
  it("suppresses self-Preview while keeping child work-item interactions default", () => {
    const child: TaskResponseDto = {
      ...TASK_BASE,
      id: "child-1",
      name: "A child task",
      type: WORK_ITEM_TYPE_KEYS.Standard,
    };

    renderView({
      organizationId: "org-1",
      projectId: "proj-1",
      task: TASK_BASE,
      taskId: TASK_BASE.id,
      activeTab: "children:STANDARD",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [child],
    });

    expect(interactionComponentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        disablePreview: true,
        entityId: "feat-1",
        entityType: TargetEntityType.Task,
      }),
    );

    const childProps = interactionComponentSpy.mock.calls
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
});

describe("FeaturePageView feature tree focus ownership", () => {
  it("passes the existing expand control through the shared card action", async () => {
    const onOpenTreeModal = vi.fn();
    renderView({
      task: TASK_BASE,
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
      isTreeVisible: true,
      onOpenTreeModal,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Expand" }));

    expect(screen.getByTestId("feature-tree-card")).toBeInTheDocument();
    expect(onOpenTreeModal).toHaveBeenCalledOnce();
  });

  it("enables focus navigation only for the inline tree while the modal is closed", async () => {
    renderView({
      task: TASK_BASE,
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
      isTreeVisible: true,
      isTreeModalOpen: false,
    });

    await screen.findByTestId("feature-tree-visualization");
    expect(featureTreeVisualizationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ focusNavigationEnabled: true }),
    );
  });

  it("draws the rail tree from the focused neighborhood, not the whole project", async () => {
    renderView({
      task: TASK_BASE,
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
      isTreeVisible: true,
      isTreeModalOpen: false,
    });

    await screen.findByTestId("feature-tree-visualization");
    expect(featureTreeVisualizationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSource: "local-neighborhood",
        activeFeatureId: TASK_BASE.id,
      }),
    );
  });

  it("transfers focus navigation ownership to the fullscreen tree", async () => {
    renderView({
      task: TASK_BASE,
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
      isTreeVisible: true,
      isTreeModalOpen: true,
    });

    await screen.findAllByTestId("feature-tree-visualization");
    const focusOwners = featureTreeVisualizationSpy.mock.calls.map(
      ([props]) =>
        (props as { focusNavigationEnabled?: boolean }).focusNavigationEnabled,
    );

    expect(focusOwners).toContain(false);
    expect(focusOwners).toContain(true);
  });
});

describe("FeaturePageView related card readiness", () => {
  it("keeps RelatedCard mounted in its loading state while the tree is loading", async () => {
    featureTreePresentationReadySpy.mockReturnValue(false);

    renderView({
      task: TASK_BASE,
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
      isTreeVisible: true,
    });

    await screen.findByTestId("feature-tree-visualization");
    expect(screen.getByTestId("feature-related-card")).toHaveAttribute(
      "data-loading",
      "true",
    );
    expect(
      screen.getByTestId("feature-related-card-loading-progress"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-related-card-content-state"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("feature-history-card")).toHaveAttribute(
      "data-loading",
      "false",
    );
  });

  it("switches RelatedCard from loading to content after the tree reaches ready", async () => {
    featureTreePresentationReadySpy.mockReturnValue(false);

    const props = {
      task: TASK_BASE,
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
      isTreeVisible: true,
    };
    const { rerender } = renderView(props);

    await screen.findByTestId("feature-tree-loading-card");
    expect(screen.getByTestId("feature-related-card")).toHaveAttribute(
      "data-loading",
      "true",
    );

    featureTreePresentationReadySpy.mockReturnValue(true);
    rerender(
      <MemoryRouter>
        <FeaturePageView {...buildFeaturePageFixture(undefined, props)} />
      </MemoryRouter>,
    );

    const relatedCard = await screen.findByTestId("feature-related-card");
    expect(relatedCard).toHaveAttribute("data-loading", "false");
    expect(
      screen.getByTestId("feature-related-card-content-state"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-related-card-loading-progress"),
    ).not.toBeInTheDocument();
  });
});

const PLAN_BASE: PlanWorkItem = {
  id: "plan-1",
  organizationId: "org-1",
  projectId: "proj-1",
  name: "Roll out auth",
  type: "PLAN",
  status: WorkStatus.Active,
  parentTaskId: TASK_BASE.id,
  source: TaskSource.User,
};

describe("FeaturePageView registry-driven children tabs", () => {
  it("renders the Design Docs tab without an eager count badge", () => {
    renderView({
      task: { ...TASK_BASE, designDocCount: 7 },
    });

    const documentsTab = screen
      .getByTestId("detail-page-tabs")
      .querySelector('[data-tab-value="documents"]');
    expect(documentsTab).toHaveTextContent("Design Docs");
    expect(documentsTab).not.toHaveTextContent("(7)");
  });

  it("renders the exact Feature child set supplied by the inverse relationship selector", () => {
    const definitions: WorkItemTypeDefinitionDto[] = [
      {
        key: "FEATURE",
        name: "Feature",
        role: WorkItemTypeRole.ProjectInfo,
        sections: [],
        allowedStatuses: [],
      },
      {
        key: "BUG",
        name: "Bug",
        role: WorkItemTypeRole.WorkItem,
        sections: [],
        allowedStatuses: [],
      },
      {
        key: "CONTRACT",
        name: "Contract",
        role: WorkItemTypeRole.ProjectInfo,
        sections: [],
        allowedStatuses: [],
      },
      {
        key: "STANDARD",
        name: "Task",
        role: WorkItemTypeRole.WorkItem,
        sections: [],
        allowedStatuses: [],
      },
      {
        key: "TASK_MONITOR",
        name: "Task Monitor",
        role: WorkItemTypeRole.Monitor,
        sections: [],
        allowedStatuses: [],
      },
      {
        key: "workflow",
        name: "Workflow",
        role: WorkItemTypeRole.Scheduled,
        sections: [],
        allowedStatuses: [],
      },
      {
        key: "ARCHIVED",
        name: "Archived Child",
        role: WorkItemTypeRole.WorkItem,
        sections: [],
        allowedStatuses: [],
      },
    ];

    renderView({
      task: TASK_BASE,
      workItemTypeDefinition: definitions[0],
      workItemSectionSelection: {
        status: "resolved",
        typeKey: "FEATURE",
        sections: [],
      },
      activeWorkItemTypeDefinitions: new Map(
        definitions
          .filter((definition) => definition.key !== "ARCHIVED")
          .map((definition) => [definition.key, definition]),
      ),
      allowedChildTypes: [
        "BUG",
        "CONTRACT",
        "FEATURE",
        "STANDARD",
        "TASK_MONITOR",
        "workflow",
      ],
    });

    const roleTabValues = Array.from(
      screen
        .getByTestId("detail-page-tabs")
        .querySelectorAll("[data-tab-value]"),
      (element) => element.getAttribute("data-tab-value"),
    );
    expect(roleTabValues).toEqual([
      "feature",
      WorkItemTypeRole.WorkItem,
      WorkItemTypeRole.ProjectInfo,
      WorkItemTypeRole.Scheduled,
      WorkItemTypeRole.Monitor,
      "plans",
      "documents",
      "conversations",
      "admin",
    ]);
    expect(screen.getByTestId("detail-page-tabs")).toHaveTextContent(
      "Work Items",
    );
    expect(screen.getByTestId("detail-page-tabs")).toHaveTextContent(
      "Project Info",
    );
    expect(screen.queryByText("Archived Child")).not.toBeInTheDocument();
  });

  it("keeps visible types selectable as subtabs inside the selected role", () => {
    renderView({
      task: TASK_BASE,
      activeTab: WorkItemTypeRole.WorkItem,
      activeType: "STANDARD",
      allowedChildTypes: ["BUG", "STANDARD"],
    });

    expect(screen.getByTestId("entity-page-child-type-tabs")).toHaveTextContent(
      "Bugs",
    );
    expect(screen.getByTestId("entity-page-child-type-tabs")).toHaveTextContent(
      "Tasks",
    );
  });

  it("renders an EntityGrid on the children:FEATURE tab", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:FEATURE",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [],
    });

    expect(screen.getByTestId("entity-grid")).toBeInTheDocument();
  });

  it("renders an EntityGrid on the children:STANDARD tab", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:STANDARD",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [],
    });

    expect(screen.getByTestId("entity-grid")).toBeInTheDocument();
    expect(entityFiltersSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: "createdAt:desc",
        sortOptions: expect.arrayContaining([
          { value: "createdAt:desc", label: "Newest" },
          { value: "updatedAt:desc", label: "Last Updated" },
        ]),
      }),
    );
  });

  it("renders an EntityGrid for a custom type like MARKETING", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:MARKETING",
      allowedChildTypes: ["FEATURE", "STANDARD", "MARKETING"],
      children: [],
    });

    expect(screen.getByTestId("entity-grid")).toBeInTheDocument();
  });

  it("does not render a child surface for an unavailable child URL", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:ARCHIVED",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [],
    });

    expect(screen.queryByTestId("entity-grid")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("entity-grid-create-button"),
    ).not.toBeInTheDocument();
  });

  it("shows an Add Feature create button from the registry on the FEATURE subtab", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:FEATURE",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [],
    });

    const btn = screen.getByTestId("entity-grid-create-button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Add Feature");
  });

  it("shows an Add Task create button on the STANDARD subtab", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:STANDARD",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [],
    });

    const btn = screen.getByTestId("entity-grid-create-button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/Add\s+Task/);
  });

  it("shows an Add <name> create button on a custom type tab using the registry name", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:MARKETING",
      allowedChildTypes: ["FEATURE", "STANDARD", "MARKETING"],
      children: [],
    });

    const btn = screen.getByTestId("entity-grid-create-button");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Add Marketing");
  });

  it("uses the registry name for built-in child types", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:BUG",
      allowedChildTypes: ["FEATURE", "STANDARD", "BUG"],
      children: [],
    });

    expect(screen.getByTestId("entity-grid-create-button")).toHaveTextContent(
      "Add Bug",
    );
  });

  it("hides the header Add button when the tab is empty (EntityGrid renders its own CTA)", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:STANDARD",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [],
    });

    expect(
      screen.queryByTestId("feature-children-create-button"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-children-discuss-button"),
    ).not.toBeInTheDocument();
  });

  it("shows the header Add and Discuss buttons when children are present", () => {
    const child: TaskResponseDto = {
      ...TASK_BASE,
      id: "child-1",
      name: "A child task",
      type: WORK_ITEM_TYPE_KEYS.Standard,
    };

    renderView({
      task: TASK_BASE,
      activeTab: "children:STANDARD",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [child],
    });

    expect(
      screen.getByTestId("feature-children-create-button"),
    ).toHaveTextContent(/Add\s+Task/);
    expect(
      screen.getByTestId("feature-children-discuss-button"),
    ).toHaveTextContent(/Discuss/);
    expect(screen.getByTestId("entity-filters")).toBeInTheDocument();
  });

  it("shows the default sort when the task tab is empty", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "children:STANDARD",
      allowedChildTypes: ["FEATURE", "STANDARD"],
      children: [],
    });

    expect(screen.getByTestId("entity-filters")).toBeInTheDocument();
  });
});

describe("FeaturePageView data debug tab", () => {
  it("renders DataDebugTab through the existing debug tab path", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "data-debug",
      isPlatformAdmin: true,
      organizationId: "org-1",
      projectId: "proj-1",
      taskId: TASK_BASE.id,
      relationshipEntityId: "feat-1",
      relationshipEntityType: "task",
    });

    expect(screen.getByTestId("feature-data-debug-tab")).toBeInTheDocument();
    expect(dataDebugTabSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        entityId: "feat-1",
        entityType: "task",
        featureId: TASK_BASE.id,
      }),
    );
  });
});

describe("FeaturePageView plans tab", () => {
  it("renders only plans linked to the active feature", () => {
    const linkedPlan: PlanWorkItem = { ...PLAN_BASE, id: "plan-linked" };
    const otherPlan: PlanWorkItem = {
      ...PLAN_BASE,
      id: "plan-other",
      parentTaskId: "feat-different",
    };

    renderView({
      task: TASK_BASE,
      activeTab: "plans",
      featurePlans: [linkedPlan],
      isPlansLoading: false,
    });

    expect(screen.getByTestId("feature-plans-list")).toBeInTheDocument();
    expect(
      screen.getByTestId(`feature-plan-link-${linkedPlan.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`feature-plan-link-${otherPlan.id}`),
    ).not.toBeInTheDocument();
  });

  it("renders an empty-state message when there are no linked plans", () => {
    renderView({
      task: TASK_BASE,
      activeTab: "plans",
      featurePlans: [],
      isPlansLoading: false,
    });

    expect(
      screen.getByText("No plans linked to this feature yet."),
    ).toBeInTheDocument();
  });
});
