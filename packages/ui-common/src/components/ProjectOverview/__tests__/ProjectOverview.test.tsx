import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivityMetricContinuationDto,
  ProjectMetricDto,
  ProjectMetricsResponseDto,
  ProjectResponseDto,
  ProposalResponseDto,
  WorkItemTypeSummaryDto,
} from "../../../api";
import {
  EntityType,
  ProjectMetricIdentity,
  ProjectMaturity,
  ProjectRole,
  ProjectStatus,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
} from "../../../api";
import { WebPathService } from "../../../services";

vi.mock("../../../data/hooks/useProjectReports", () => ({
  useProjectReports: () => ({
    reports: [],
    isFetched: true,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useProjectReadyFutures", () => ({
  useProjectReadyFutures: () => ({
    isPending: false,
    isError: false,
    data: { items: [], total: 0, limit: 10, offset: 0, unavailableCount: 0 },
  }),
}));

const useProject = vi.hoisted(() => vi.fn());
const useProjectMetrics = vi.hoisted(() => vi.fn());
const useEntityStar = vi.hoisted(() => vi.fn());
const useProposals = vi.hoisted(() => vi.fn());
const useWorkItemTypes = vi.hoisted(() => vi.fn());
const useWorkItems = vi.hoisted(() => vi.fn());

vi.mock("../../../data/hooks/useProject", () => ({ useProject }));
vi.mock("../../../data/hooks/useProjectMetrics", () => ({
  useProjectMetrics,
}));
vi.mock("../../../data/hooks/useEntityStars", () => ({ useEntityStar }));
vi.mock("../../../data/hooks/useProposals", () => ({ useProposals }));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({ useWorkItemTypes }));
vi.mock("../../../data/hooks/useWorkItems", () => ({ useWorkItems }));
const canHoverState = vi.hoisted(() => ({ value: true }));
vi.mock("../../../hooks/useCanHover", () => ({
  useCanHover: () => canHoverState.value,
}));

import { ProjectInfoActivity, ProjectOverview } from "../ProjectOverview";

const ORGANIZATION_ID = "organization-1";
const PROJECT_ID = "project-1";
const WINDOW_START = "2026-09-04T12:00:00.000Z";
const WINDOW_END = "2026-09-05T12:00:00.000Z";
const PROJECT_INFO_PAGE_SIZE = 8;

const project: ProjectResponseDto = {
  id: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  name: "Authoritative Project",
  description: "The project description returned by the platform.",
  status: ProjectStatus.Active,
  currentUserRole: ProjectRole.Owner,
  hasEstablishedActivity: true,
  maturity: ProjectMaturity.Established,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const identities = Object.values(ProjectMetricIdentity);

const makeMetric = (
  metric: ProjectMetricIdentity,
  value: number,
): ProjectMetricDto => ({
  metric,
  value,
  activityContinuation: {
    metric,
    projectIds: [PROJECT_ID],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    actorScope: { mode: "ORGANIZATION" },
  },
});

const makeMetrics = (value = 1): ProjectMetricsResponseDto => ({
  metrics: identities.map((identity, index) =>
    makeMetric(identity, value === 0 ? 0 : value + index),
  ),
  effectiveProjectIds: [PROJECT_ID],
  windowStart: WINDOW_START,
  windowEnd: WINDOW_END,
  actorScope: { mode: "ORGANIZATION" },
});

const workItemType = (
  key: string,
  name: string,
  role: WorkItemTypeRole,
  status = WorkItemTypeLifecycleStatus.Active,
  iconKey?: WorkItemTypeSummaryDto["definition"]["iconKey"],
): WorkItemTypeSummaryDto => ({
  id: `type-${key}`,
  projectId: PROJECT_ID,
  status,
  effectiveSource: WorkItemTypeEffectiveSource.Canonical,
  definition: { key, name, role, sections: [], allowedStatuses: [], iconKey },
});

const registry: WorkItemTypeSummaryDto[] = [
  workItemType(
    "STANDARD",
    "Tasks",
    WorkItemTypeRole.WorkItem,
    undefined,
    "task",
  ),
  workItemType(
    "FEATURE",
    "Features",
    WorkItemTypeRole.ProjectInfo,
    undefined,
    "feature",
  ),
  workItemType(
    "CUSTOM_PROJECT_INFO",
    "Custom Project Info",
    WorkItemTypeRole.ProjectInfo,
  ),
  workItemType("PLAN", "Plans", WorkItemTypeRole.WorkItem, undefined, "plan"),
  workItemType(
    "mockup",
    "Mockup",
    WorkItemTypeRole.ProjectInfo,
    undefined,
    "design",
  ),
  workItemType(
    "decision",
    "Decision",
    WorkItemTypeRole.ProjectInfo,
    undefined,
    "decision",
  ),
  workItemType(
    "SCHEDULED_REPORT",
    "Scheduled Reports",
    WorkItemTypeRole.Scheduled,
  ),
  workItemType("TASK_MONITOR", "Task Monitors", WorkItemTypeRole.Monitor),
  workItemType(
    "ARCHIVED_INFO",
    "Archived Info",
    WorkItemTypeRole.ProjectInfo,
    WorkItemTypeLifecycleStatus.Archived,
  ),
];

const proposal = (
  id: string,
  action: ProposalAction,
  overrides: Partial<ProposalResponseDto> = {},
): ProposalResponseDto =>
  ({
    id,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    type: ProposalType.Single,
    action,
    status: ProposalStatus.Draft,
    targetEntityId: `${id}-target`,
    targetEntityType: TargetEntityType.Task,
    title: `${id} target`,
    updates: { type: "FEATURE" },
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-09-05T08:00:00.000Z",
    updatedAt: "2026-09-05T08:00:00.000Z",
    ...overrides,
  }) as ProposalResponseDto;

const projectRefetch = vi.fn();
const metricsRefetch = vi.fn();
const proposalsRefetch = vi.fn();
const registryRefetch = vi.fn();
const targetTasksRefetch = vi.fn();
const toggleStar = vi.fn();

const readyProjectResult = () => ({
  data: project,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: projectRefetch,
  markStale: vi.fn(),
});

const readyMetricsResult = (data = makeMetrics()) => ({
  data,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: metricsRefetch,
  markStale: vi.fn(),
});

const readyProposalResult = (
  data: ProposalResponseDto[],
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  },
) => ({
  data,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: proposalsRefetch,
  markStale: vi.fn(),
  pagination,
});

const readyRegistryResult = () => ({
  data: registry,
  workItemTypes: registry,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: registryRefetch,
  markStale: vi.fn(),
});

const readyTargetTasksResult = (
  workItems: Array<{ id: string; type: string }>,
) => ({
  workItems,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: targetTasksRefetch,
  markStale: vi.fn(),
});

const readyStarResult = () => ({
  isStarred: false,
  isLoading: false,
  isMutating: false,
  error: null,
  mutationError: null,
  toggle: toggleStar,
});

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  );
};

const renderOverview = () =>
  render(
    <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
      <ProjectOverview
        organizationId={ORGANIZATION_ID}
        projectId={PROJECT_ID}
      />
      <LocationProbe />
    </MemoryRouter>,
  );

const getProposalRow = (proposalId: string): HTMLElement => {
  const row = screen
    .getAllByTestId("project-info-proposal-row")
    .find(
      (candidate) => candidate.getAttribute("data-proposal-id") === proposalId,
    );
  if (!row) throw new Error(`Proposal row not found: ${proposalId}`);
  return row;
};

describe("ProjectOverview", () => {
  it.each([ProjectMaturity.TakingShape, ProjectMaturity.Established])(
    "shows the title label only when maturity=%s, preserving lifecycle and star actions",
    (maturity) => {
      useProject.mockReturnValue({
        ...readyProjectResult(),
        data: { ...project, maturity },
      });
      renderOverview();
      if (maturity === ProjectMaturity.TakingShape)
        expect(
          screen.getByTestId("project-taking-shape-label"),
        ).toBeInTheDocument();
      else
        expect(
          screen.queryByTestId("project-taking-shape-label"),
        ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("project-overview-star-toggle"),
      ).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();
    },
  );
  beforeEach(() => {
    vi.clearAllMocks();
    projectRefetch.mockResolvedValue(project);
    metricsRefetch.mockResolvedValue(makeMetrics());
    proposalsRefetch.mockResolvedValue([]);
    registryRefetch.mockResolvedValue(registry);
    targetTasksRefetch.mockResolvedValue([]);
    toggleStar.mockResolvedValue(undefined);
    useProject.mockReturnValue(readyProjectResult());
    useProjectMetrics.mockReturnValue(readyMetricsResult());
    useEntityStar.mockReturnValue(readyStarResult());
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction },
      ) =>
        readyProposalResult(options.action === ProposalAction.Create ? [] : []),
    );
    useWorkItemTypes.mockReturnValue(readyRegistryResult());
    useWorkItems.mockReturnValue(readyTargetTasksResult([]));
  });

  it.each([false, true])(
    "offers cancellation for ONBOARDING with established activity %s",
    (hasEstablishedActivity) => {
      useProject.mockReturnValue({
        ...readyProjectResult(),
        data: {
          ...project,
          status: ProjectStatus.Onboarding,
          hasEstablishedActivity,
        },
      });
      renderOverview();
      expect(
        screen.getByRole("button", { name: "Cancel Onboarding" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("project-overview-star-toggle"),
      ).not.toBeInTheDocument();
    },
  );

  it.each([ProjectRole.Architect, ProjectRole.Member, ProjectRole.Viewer])(
    "hides cancellation of ONBOARDING from a project %s",
    (currentUserRole) => {
      useProject.mockReturnValue({
        ...readyProjectResult(),
        data: { ...project, status: ProjectStatus.Onboarding, currentUserRole },
      });
      renderOverview();
      expect(
        screen.queryByRole("button", { name: "Cancel Onboarding" }),
      ).not.toBeInTheDocument();
    },
  );

  it.each(
    Object.values(ProjectStatus).filter(
      (status) => status !== ProjectStatus.Onboarding,
    ),
  )("preserves starring for %s", (status) => {
    useProject.mockReturnValue({
      ...readyProjectResult(),
      data: { ...project, status },
    });
    renderOverview();
    expect(
      screen.getByTestId("project-overview-star-toggle"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel Onboarding" }),
    ).not.toBeInTheDocument();
  });

  it("renders Mockup and Decision proposal icons from matching registry definitions", () => {
    const proposals = [
      proposal("created-mockup", ProposalAction.Create, {
        title: "Mockup preview",
        updates: { type: "mockup" },
      }),
      proposal("created-decision", ProposalAction.Create, {
        title: "Project choice",
        updates: { type: "decision" },
      }),
    ];
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction },
      ) =>
        readyProposalResult(
          options.action === ProposalAction.Create ? proposals : [],
        ),
    );

    renderOverview();

    expect(
      within(getProposalRow("created-mockup"))
        .getByTestId("project-info-proposal-icon")
        .querySelector("svg"),
    ).toHaveAttribute("viewBox", "0 0 20 20");
    expect(
      within(getProposalRow("created-decision"))
        .getByTestId("project-info-proposal-icon")
        .querySelector("svg"),
    ).toHaveAttribute("viewBox", "0 0 256 256");
  });

  it("renders Project Activity and Task Activity in order", () => {
    renderOverview();

    expect(
      screen.getByRole("heading", { name: "Authoritative Project", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The project description returned by the platform."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Project status: Active")).toBeInTheDocument();

    const identity = screen.getByTestId("project-overview-identity");
    const metadata = within(identity).getByTestId("project-metadata");
    expect(metadata.querySelector("time")).toHaveAttribute(
      "datetime",
      project.updatedAt,
    );
    expect(metadata).toHaveTextContent("Updated Sep 1, 2026");
    expect(within(identity).queryByText(/Created/)).not.toBeInTheDocument();
    expect(getComputedStyle(identity).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(identity).boxShadow).toBe("");
    const title = within(identity).getByRole("heading", { level: 1 });
    expect(getComputedStyle(title).fontSize).toBe("2.125rem");
    expect(getComputedStyle(title).fontWeight).toBe("600");
    expect(getComputedStyle(title).fontFamily).toContain('"Work Sans"');
    expect(
      title.compareDocumentPosition(metadata) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      metadata.compareDocumentPosition(screen.getByText(project.description!)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByTestId("project-info-activity")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Project Activity" }),
    ).toBeVisible();
    expect(
      screen.getByRole("combobox", {
        name: "Project Activity time range",
      }),
    ).toHaveTextContent("Last 24 hours");
    expect(
      screen.getByTestId("organization-home-throughput"),
    ).toBeInTheDocument();
    expect(screen.getByText("Task Activity")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Task Activity time range" }),
    ).toHaveTextContent("Last 24 hours");
    expect(
      screen.queryByTestId("organization-home-updates"),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByTestId("project-overview-identity")
        .compareDocumentPosition(screen.getByTestId("project-info-activity")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("project-info-activity")
        .compareDocumentPosition(
          screen.getByTestId("organization-home-throughput"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByTestId("organization-home-metric-bar")).toHaveLength(
      identities.length - 2,
    );
  });

  it("hides the Project Activity info control on devices that cannot hover", () => {
    canHoverState.value = false;
    try {
      renderOverview();
      expect(
        screen.queryByTestId("project-activity-info"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: "Project Activity time range" }),
      ).toBeInTheDocument();
    } finally {
      canHoverState.value = true;
    }
  });

  it("explains both project sections through keyboard-accessible controls", async () => {
    const user = userEvent.setup();
    renderOverview();

    const projectInfo = screen.getByRole("button", {
      name: "About Project Activity",
    });
    expect(
      screen.getByRole("heading", { name: "Project Activity" }).parentElement,
    ).toContainElement(projectInfo);
    expect(
      screen.getByRole("heading", { name: "Project Activity" }).parentElement,
    ).not.toContainElement(
      screen.getByRole("combobox", { name: "Project Activity time range" }),
    );
    await user.click(projectInfo);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Updates to project information and structure",
    );
    const taskInfo = screen.getByRole("button", {
      name: "About Task Activity",
    });
    expect(
      screen.getByRole("heading", { name: "Task Activity" }).parentElement,
    ).toContainElement(taskInfo);
    expect(
      screen.getByRole("heading", { name: "Task Activity" }).parentElement,
    ).not.toContainElement(
      screen.getByRole("combobox", { name: "Task Activity time range" }),
    );
    await user.click(taskInfo);
    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "Implementation work and its progress",
      ),
    );
  });

  it("renders the server-scoped registry, Design Doc, and PLAN activity", async () => {
    const created = [
      proposal("created-feature", ProposalAction.Create, {
        title: "Customer onboarding",
        eli5: "Introduces the customer onboarding flow.",
        updates: {
          type: "FEATURE",
          name: "Customer onboarding",
          tag: "frontend",
          sections: [
            {
              key: "description",
              order: 0,
              content: "The proposed onboarding flow for new customers.",
            },
          ],
        },
        groupMembership: {
          groupId: "group-1",
          memberId: "member-1",
          memberOrder: 0,
          revision: 1,
          lifecycle: "OPEN",
        },
      }),
      proposal("created-doc", ProposalAction.Create, {
        targetEntityType: TargetEntityType.DesignDoc,
        title: "Onboarding decisions",
        updates: { name: "Onboarding decisions" },
      }),
      proposal("created-plan", ProposalAction.Create, {
        title: "Launch plan",
        updates: { type: "PLAN", name: "Launch plan" },
      }),
      proposal("created-tag-only", ProposalAction.Create, {
        title: "Tagged project concept",
        updates: {
          type: "FEATURE",
          name: "Tagged project concept",
          tag: "frontend",
          sections: [
            {
              key: "graphPresentation",
              order: 0,
              content: { nodes: [] },
            },
          ],
        },
      }),
    ];
    const updated = [
      proposal("updated-custom", ProposalAction.Update, {
        title: "Custom project concept",
        eli5: "Clarifies the project's goal.",
        targetEntityId: "custom-target",
        updates: {
          name: "Custom project concept",
          sections: [
            {
              key: "purpose",
              order: 0,
              content: "Explain the project's goal.",
            },
          ],
        },
      }),
      proposal("updated-doc", ProposalAction.Update, {
        targetEntityType: TargetEntityType.DesignDoc,
        title: "Updated design doc",
        updates: { name: "Updated design doc" },
        status: ProposalStatus.Approved,
      }),
    ];
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction },
      ) =>
        options.action === ProposalAction.Create
          ? readyProposalResult(created)
          : readyProposalResult(updated),
    );
    useWorkItems.mockReturnValue(
      readyTargetTasksResult([
        { id: "custom-target", type: "CUSTOM_PROJECT_INFO" },
        { id: "task-target", type: "STANDARD" },
      ]),
    );

    renderOverview();

    expect(
      screen.getByRole("tab", { name: "Created (4)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Updated (2)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Customer onboarding")).toBeInTheDocument();
    expect(screen.getByText("Onboarding decisions")).toBeInTheDocument();
    expect(screen.getByText("Launch plan")).toBeInTheDocument();
    expect(screen.getByText("Tagged project concept")).toBeInTheDocument();
    expect(
      within(getProposalRow("created-feature")).getByTestId(
        "project-info-proposal-icon",
      ),
    ).toBeInTheDocument();
    expect(
      within(getProposalRow("created-feature")).getByTestId(
        "project-info-proposal-eli5",
      ),
    ).toHaveTextContent("Introduces the customer onboarding flow.");
    expect(
      within(getProposalRow("created-tag-only")).queryByTestId(
        "project-info-proposal-eli5",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Needs review")).toHaveLength(4);
    expect(
      screen.queryByText(/Proposal created-feature/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Features")).not.toBeInTheDocument();
    expect(screen.queryByText("Design Doc")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan")).not.toBeInTheDocument();
    expect(screen.getAllByRole("time")).toHaveLength(5);

    await userEvent.click(screen.getByRole("tab", { name: "Updated (2)" }));
    expect(screen.getByText("Custom project concept")).toBeInTheDocument();
    expect(screen.getByText("Updated design doc")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();

    const sectionEli5 = within(getProposalRow("updated-custom")).getByTestId(
      "project-info-proposal-eli5",
    );
    expect(sectionEli5).toHaveTextContent("Clarifies the project's goal.");
    expect(sectionEli5).not.toHaveTextContent("purpose");
  });

  it("uses action-filtered project proposal queries for both matching tab totals and rows", () => {
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction },
      ) =>
        readyProposalResult([
          proposal(
            options.action === ProposalAction.Create ? "created" : "updated",
            options.action ?? ProposalAction.Create,
            { updates: { type: "FEATURE" } },
          ),
        ]),
    );

    renderOverview();

    expect(useProposals).toHaveBeenNthCalledWith(
      1,
      ORGANIZATION_ID,
      PROJECT_ID,
      {
        action: ProposalAction.Create,
        workItemRole: WorkItemTypeRole.ProjectInfo,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        enabled: true,
        limit: PROJECT_INFO_PAGE_SIZE,
        offset: 0,
      },
    );
    expect(useProposals).toHaveBeenNthCalledWith(
      2,
      ORGANIZATION_ID,
      PROJECT_ID,
      {
        action: ProposalAction.Update,
        workItemRole: WorkItemTypeRole.ProjectInfo,
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        enabled: true,
        limit: PROJECT_INFO_PAGE_SIZE,
        offset: 0,
      },
    );
    expect(
      screen.getByRole("tab", { name: "Created (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Updated (1)" }),
    ).toBeInTheDocument();
    expect(getProposalRow("created")).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("project-info-proposal-row")
        .map((row) => row.getAttribute("data-proposal-id")),
    ).not.toContain("updated");
  });

  it("derives another page from a full eight-row response without pagination metadata", async () => {
    const firstPage = Array.from(
      { length: PROJECT_INFO_PAGE_SIZE },
      (_, index) =>
        proposal(`created-derived-page-${index}`, ProposalAction.Create, {
          updates: {
            type: "FEATURE",
            name: `Created derived page ${index}`,
          },
        }),
    );
    const secondPage = [
      proposal("created-derived-page-8", ProposalAction.Create, {
        updates: { type: "FEATURE", name: "Created derived page 8" },
      }),
    ];
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction; offset?: number },
      ) =>
        options.action === ProposalAction.Create
          ? readyProposalResult(
              options.offset === PROJECT_INFO_PAGE_SIZE
                ? secondPage
                : firstPage,
            )
          : readyProposalResult([]),
    );

    const user = userEvent.setup();
    renderOverview();

    expect(
      screen.getByRole("tab", { name: "Created (8)" }),
    ).toBeInTheDocument();
    const pagination = screen.getByTestId(
      "project-info-activity-created-pagination",
    );
    expect(
      within(pagination).getByRole("button", { name: "Go to page 2" }),
    ).toBeInTheDocument();

    await user.click(
      within(pagination).getByRole("button", { name: "Go to page 2" }),
    );
    await waitFor(() => {
      expect(getProposalRow("created-derived-page-8")).toBeInTheDocument();
    });
    expect(
      screen
        .getAllByTestId("project-info-proposal-row")
        .map((row) => row.getAttribute("data-proposal-id")),
    ).toEqual(["created-derived-page-8"]);
    expect(useProposals).toHaveBeenCalledWith(ORGANIZATION_ID, PROJECT_ID, {
      action: ProposalAction.Create,
      workItemRole: WorkItemTypeRole.ProjectInfo,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      enabled: true,
      limit: PROJECT_INFO_PAGE_SIZE,
      offset: PROJECT_INFO_PAGE_SIZE,
    });
  });

  it("loads project proposals while the metrics window is still unavailable", async () => {
    const updated = proposal("updated-before-metrics", ProposalAction.Update, {
      title: "Project update",
      updates: {
        type: "FEATURE",
        description: "This project update is available before metrics resolve.",
      },
    });
    useProjectMetrics.mockReturnValue({
      ...readyMetricsResult(),
      data: null,
      isFetched: false,
      isReady: false,
      isLoading: true,
    });
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction },
      ) =>
        readyProposalResult(
          options.action === ProposalAction.Update ? [updated] : [],
        ),
    );

    renderOverview();

    expect(useProposals).toHaveBeenNthCalledWith(
      1,
      ORGANIZATION_ID,
      PROJECT_ID,
      expect.objectContaining({
        action: ProposalAction.Create,
        enabled: true,
        windowStart: undefined,
        windowEnd: undefined,
      }),
    );
    expect(useProposals).toHaveBeenNthCalledWith(
      2,
      ORGANIZATION_ID,
      PROJECT_ID,
      expect.objectContaining({
        action: ProposalAction.Update,
        enabled: true,
        windowStart: undefined,
        windowEnd: undefined,
      }),
    );

    await userEvent.click(screen.getByRole("tab", { name: "Updated (1)" }));
    expect(getProposalRow("updated-before-metrics")).toBeInTheDocument();
  });

  it("uses numbered pages without changing the action filters or count-row match", async () => {
    const firstPage = Array.from(
      { length: PROJECT_INFO_PAGE_SIZE },
      (_, index) =>
        proposal(`created-page-${index}`, ProposalAction.Create, {
          updates: { type: "FEATURE", name: `Created page ${index}` },
        }),
    );
    const secondPage = Array.from(
      { length: PROJECT_INFO_PAGE_SIZE },
      (_, index) =>
        proposal(
          `created-page-${index + PROJECT_INFO_PAGE_SIZE}`,
          ProposalAction.Create,
          {
            updates: {
              type: "FEATURE",
              name: `Created page ${index + PROJECT_INFO_PAGE_SIZE}`,
            },
          },
        ),
    );
    const thirdPage = [
      proposal("created-page-16", ProposalAction.Create, {
        updates: { type: "FEATURE", name: "Created page 16" },
      }),
    ];
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction; offset?: number },
      ) => {
        if (options.action !== ProposalAction.Create) {
          return readyProposalResult([]);
        }

        const page = Math.floor((options.offset ?? 0) / PROJECT_INFO_PAGE_SIZE);
        const data = [firstPage, secondPage, thirdPage][page] ?? [];
        return readyProposalResult(data, {
          page: page + 1,
          limit: PROJECT_INFO_PAGE_SIZE,
          total: 17,
          totalPages: 3,
          hasNext: page < 2,
          hasPrevious: page > 0,
        });
      },
    );

    const user = userEvent.setup();
    renderOverview();

    expect(
      screen.getByRole("tab", { name: "Created (17)" }),
    ).toBeInTheDocument();
    const pagination = screen.getByTestId(
      "project-info-activity-created-pagination",
    );
    await user.click(
      within(pagination).getByRole("button", { name: "Go to page 2" }),
    );

    await waitFor(() => {
      expect(getProposalRow("created-page-8")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("tab", { name: "Created (17)" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("project-info-proposal-row")
        .map((row) => row.getAttribute("data-proposal-id")),
    ).not.toContain("created-page-0");
    expect(useProposals).toHaveBeenCalledWith(ORGANIZATION_ID, PROJECT_ID, {
      action: ProposalAction.Create,
      workItemRole: WorkItemTypeRole.ProjectInfo,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      enabled: true,
      limit: PROJECT_INFO_PAGE_SIZE,
      offset: PROJECT_INFO_PAGE_SIZE,
    });

    await user.click(
      within(
        screen.getByTestId("project-info-activity-created-pagination"),
      ).getByRole("button", { name: "Go to page 3" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: "Created (17)" }),
      ).toBeInTheDocument();
    });
    expect(getProposalRow("created-page-16")).toBeInTheDocument();
    expect(screen.getAllByTestId("project-info-proposal-row")).toHaveLength(1);
  });

  it("routes grouped proposals to group review and ungrouped proposals to proposal detail", async () => {
    const grouped = proposal("grouped", ProposalAction.Create, {
      updates: { type: "FEATURE" },
      groupMembership: {
        groupId: "group-1",
        memberId: "member-1",
        memberOrder: 0,
        revision: 1,
        lifecycle: "OPEN",
      },
    });
    const ungrouped = proposal("ungrouped", ProposalAction.Create, {
      updates: { type: "PLAN" },
    });
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction },
      ) =>
        readyProposalResult(
          options.action === ProposalAction.Create ? [grouped, ungrouped] : [],
        ),
    );

    const user = userEvent.setup();
    renderOverview();
    await user.click(getProposalRow("grouped"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      WebPathService.proposalGroup({
        projectId: PROJECT_ID,
        groupId: "group-1",
      }),
    );

    await user.click(getProposalRow("ungrouped"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      WebPathService.proposal({
        projectId: PROJECT_ID,
        proposalId: "ungrouped",
      }),
    );
  });

  it("keeps activity loading, empty, and failure states local to the activity card", async () => {
    useWorkItemTypes.mockReturnValue({
      ...readyRegistryResult(),
      workItemTypes: [],
      data: [],
      isReady: false,
      isFetched: false,
      isLoading: true,
    });
    const rendered = renderOverview();
    expect(screen.getByTestId("project-info-activity-loading")).toBeVisible();
    expect(screen.getByTestId("project-overview-identity")).toBeInTheDocument();
    expect(
      screen.getByTestId("organization-home-throughput"),
    ).toBeInTheDocument();

    useWorkItemTypes.mockReturnValue(readyRegistryResult());
    useProposals.mockImplementation(
      (
        _organizationId: string,
        _projectId: string,
        options: { action?: ProposalAction },
      ) =>
        readyProposalResult(options.action === ProposalAction.Create ? [] : []),
    );
    rendered.rerender(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <ProjectOverview
          organizationId={ORGANIZATION_ID}
          projectId={PROJECT_ID}
        />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("project-info-activity-empty")).toHaveTextContent(
      "No project information proposals created yet.",
    );

    useProposals.mockReturnValue({
      ...readyProposalResult([]),
      error: new Error("proposals unavailable"),
      isReady: false,
    });
    rendered.rerender(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <ProjectOverview
          organizationId={ORGANIZATION_ID}
          projectId={PROJECT_ID}
        />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("project-info-activity-refresh-error"),
    ).toHaveTextContent("Retry");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(registryRefetch).toHaveBeenCalled();
    expect(proposalsRefetch).toHaveBeenCalled();
  });

  it("renders explicit project loading and retryable failure states", async () => {
    const user = userEvent.setup();
    useProject.mockReturnValue({
      ...readyProjectResult(),
      data: null,
      isLoading: true,
      isFetched: false,
      isReady: false,
    });
    const rendered = renderOverview();

    expect(screen.getByTestId("project-overview-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("project-overview-identity")).toBeNull();

    useProject.mockReturnValue({
      ...readyProjectResult(),
      data: null,
      isReady: false,
      error: new Error("project unavailable"),
    });
    rendered.rerender(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <ProjectOverview
          organizationId={ORGANIZATION_ID}
          projectId={PROJECT_ID}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("project-overview-project-error"),
    ).toHaveTextContent("We couldn't load this project.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(projectRefetch).toHaveBeenCalledTimes(1);
  });

  it("keeps star loading and failures explicit", () => {
    useEntityStar.mockReturnValue({
      ...readyStarResult(),
      isLoading: true,
    });
    const rendered = renderOverview();

    expect(screen.getByRole("button", { name: "Star" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Star" })).toHaveAttribute(
      "aria-busy",
      "true",
    );

    useEntityStar.mockReturnValue({
      ...readyStarResult(),
      error: new Error("star unavailable"),
    });
    rendered.rerender(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <ProjectOverview
          organizationId={ORGANIZATION_ID}
          projectId={PROJECT_ID}
        />
        <LocationProbe />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to load star state",
    );
    expect(screen.queryByText(PROJECT_ID)).toBeNull();
  });

  it("renders metric failure with retry and zero-valued metric bars", async () => {
    const user = userEvent.setup();
    useProjectMetrics.mockReturnValue({
      ...readyMetricsResult(),
      data: null,
      isReady: false,
      error: new Error("metrics unavailable"),
    });
    const rendered = renderOverview();

    expect(
      screen.getByTestId("organization-home-evidence-error"),
    ).toHaveTextContent("We couldn't load rolling metrics.");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(metricsRefetch).toHaveBeenCalledTimes(1);

    useProjectMetrics.mockReturnValue(readyMetricsResult(makeMetrics(0)));
    rendered.rerender(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
        <ProjectOverview
          organizationId={ORGANIZATION_ID}
          projectId={PROJECT_ID}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(
      screen.queryByText("No matching events in this rolling 24-hour window."),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTestId("organization-home-metric-bar")).toHaveLength(
      identities.length - 2,
    );
  });

  it("opens Activity with the exact metric continuation returned by the server", async () => {
    const user = userEvent.setup();
    const data = makeMetrics();
    const continuation: ActivityMetricContinuationDto = {
      ...data.metrics[0]!.activityContinuation,
      projectIds: [PROJECT_ID, "project-2"],
      windowStart: "2026-09-04T12:03:04.000Z",
      windowEnd: "2026-09-05T12:03:04.000Z",
    };
    data.metrics[0] = {
      ...data.metrics[0]!,
      activityContinuation: continuation,
    };
    useProjectMetrics.mockReturnValue(readyMetricsResult(data));
    renderOverview();

    const metricControl = screen.getByRole("button", {
      name: new RegExp(
        `Tasks, Created, 1, .*Rolling 24 hours: ${WINDOW_START} – ${WINDOW_END}`,
      ),
    });
    metricControl.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("location")).toHaveTextContent(
      WebPathService.organizationActivity({
        organizationId: ORGANIZATION_ID,
        viewScope: "project",
        metricContinuation: continuation,
      }),
    );
  });
});

describe("activity refresh continuity", () => {
  it("resets replacement pages before reading a new project scope", async () => {
    useProposals.mockReturnValue(
      readyProposalResult([proposal("page-row", ProposalAction.Create)], {
        page: 1,
        limit: 8,
        total: 16,
        totalPages: 2,
        hasNext: true,
        hasPrevious: false,
      }),
    );
    const rendered = render(activity());
    await userEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    expect(useProposals).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      PROJECT_ID,
      expect.objectContaining({ offset: 8 }),
    );
    useProposals.mockClear();
    useProposals.mockReturnValue({
      ...readyProposalResult([]),
      isFetching: true,
    });
    rendered.rerender(activity("replacement-project"));
    for (const call of useProposals.mock.calls) {
      expect(call[1]).toBe("replacement-project");
      expect(call[2].offset).toBe(0);
    }
    expect(screen.queryByTestId("project-info-proposal-row")).toBeNull();
  });

  it("keeps target hydration subscribed while proposal data is withheld", () => {
    useProposals.mockReturnValue(
      readyProposalResult([
        proposal("hydrate", ProposalAction.Create, { updates: {} }),
      ]),
    );
    const rendered = render(activity());
    useProposals.mockReturnValue({
      ...readyProposalResult([]),
      isFetching: true,
    });
    rendered.rerender(activity());
    expect(useWorkItems).toHaveBeenLastCalledWith(
      ORGANIZATION_ID,
      "task",
      PROJECT_ID,
      undefined,
      { taskIds: ["hydrate-target"], enabled: true, websocketsEnabled: false },
    );
    expect(getProposalRow("hydrate")).toBeInTheDocument();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useWorkItemTypes.mockReturnValue(readyRegistryResult());
    useWorkItems.mockReturnValue(readyTargetTasksResult([]));
    registryRefetch.mockResolvedValue([]);
    proposalsRefetch.mockResolvedValue([]);
    targetTasksRefetch.mockResolvedValue([]);
  });
  const activity = (
    projectId = PROJECT_ID,
    organizationId = ORGANIZATION_ID,
    windowStart = WINDOW_START,
  ) => (
    <MemoryRouter>
      <ProjectInfoActivity
        organizationId={organizationId}
        projectId={projectId}
        windowStart={windowStart}
        windowEnd={WINDOW_END}
      />
    </MemoryRouter>
  );

  it("keeps rows and counts through withheld reads, retry, repeat failure, and recovery", async () => {
    const rows = [
      proposal("retained-row", ProposalAction.Create, {
        updates: { type: "FEATURE" },
      }),
    ];
    useProposals.mockReturnValue(readyProposalResult(rows));
    const rendered = render(activity());
    const row = getProposalRow("retained-row");
    row.focus();
    useProposals.mockReturnValue({
      ...readyProposalResult([]),
      isFetching: true,
      isLoading: true,
    });
    rendered.rerender(activity());
    expect(getProposalRow("retained-row")).toBe(row);
    expect(row).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Created (1)" })).toBeVisible();
    expect(screen.getByLabelText("Refreshing Project Activity")).toBeVisible();
    useProposals.mockReturnValue({
      ...readyProposalResult([]),
      error: new Error("failed"),
      isReady: false,
    });
    rendered.rerender(activity());
    expect(getProposalRow("retained-row")).toBe(row);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(proposalsRefetch).toHaveBeenCalled();
    useProposals.mockReturnValue({
      ...readyProposalResult([]),
      isFetching: true,
    });
    rendered.rerender(activity());
    expect(getProposalRow("retained-row")).toBe(row);
    useProposals.mockReturnValue({
      ...readyProposalResult([]),
      error: new Error("again"),
      isReady: false,
    });
    rendered.rerender(activity());
    expect(
      screen.getByTestId("project-info-activity-refresh-error"),
    ).toBeVisible();
    useProposals.mockReturnValue(readyProposalResult([]));
    rendered.rerender(activity());
    expect(
      screen.queryByTestId("project-info-activity-refresh-error"),
    ).toBeNull();
    expect(screen.getByTestId("project-info-activity-empty")).toBeVisible();
  });

  it.each(["project", "organization", "window", "action"])(
    "discards retained rows when %s changes",
    async (scope) => {
      useProposals.mockReturnValue(
        readyProposalResult([proposal("old-row", ProposalAction.Create)]),
      );
      const rendered = render(activity());
      if (scope === "action") {
        useProposals.mockReturnValue({
          ...readyProposalResult([]),
          isFetching: true,
        });
        await userEvent.click(screen.getByRole("tab", { name: "Updated (1)" }));
      } else {
        useProposals.mockReturnValue({
          ...readyProposalResult([]),
          isFetching: true,
        });
        rendered.rerender(
          activity(
            scope === "project" ? "other-project" : PROJECT_ID,
            scope === "organization" ? "other-org" : ORGANIZATION_ID,
            scope === "window" ? WINDOW_END : WINDOW_START,
          ),
        );
      }
      expect(screen.queryByTestId("project-info-proposal-row")).toBeNull();
      expect(screen.getByTestId("project-info-activity-loading")).toBeVisible();
    },
  );

  it("waits for registry and sequential target hydration, and exposes their explicit failures", async () => {
    useProposals.mockReturnValue(
      readyProposalResult([
        proposal("hydrate", ProposalAction.Create, { updates: {} }),
      ]),
    );
    useWorkItems.mockReturnValue({
      ...readyTargetTasksResult([]),
      isReady: false,
      isFetching: true,
    });
    const rendered = render(activity());
    expect(screen.getByTestId("project-info-activity-loading")).toBeVisible();
    useWorkItems.mockReturnValue({
      ...readyTargetTasksResult([]),
      isReady: false,
      error: new Error("target failed"),
    });
    rendered.rerender(activity());
    await waitFor(() =>
      expect(screen.getByTestId("project-info-activity-error")).toBeVisible(),
    );
  });
});
