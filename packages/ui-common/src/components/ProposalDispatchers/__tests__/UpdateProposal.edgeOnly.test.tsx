import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  ProposalAction,
  ProposalEdgeTargetType,
  ProposalEdgeType,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type TaskResponseDto,
  type AgentEdgeResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { UpdateProposal } from "../UpdateProposal";

const { entities, useEntityDataMock } = vi.hoisted(() => ({
  entities: {} as Record<string, { type: "task"; data: TaskResponseDto }>,
  useEntityDataMock: vi.fn(),
}));
const getTaskMock = vi.hoisted(() => vi.fn());

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getTask: getTaskMock },
}));

vi.mock("../useEntityData", () => ({
  useEntityData: (...args: unknown[]) => useEntityDataMock(...args),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: undefined,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypes: () => ({
    workItemTypes: [
      {
        definition: {
          key: "STANDARD",
          name: "Task",
          sections: [],
          allowedStatuses: [],
        } satisfies WorkItemTypeDefinitionDto,
        status: "ACTIVE",
        projectId: "project-1",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useWorkItemTypeLifecycle", () => ({
  useMarkWorkItemTypeDataStale: () => vi.fn(),
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({
    services: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: undefined }),
}));

vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    task: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
    feature: ({ featureId }: { featureId: string }) => `/features/${featureId}`,
    designDoc: ({ designDocId }: { designDocId: string }) =>
      `/design-docs/${designDocId}`,
  }),
}));

vi.mock("../../InteractionComponent", async () => {
  const actual = await vi.importActual<
    typeof import("../../InteractionComponent")
  >("../../InteractionComponent");

  return {
    ...actual,
    InteractionComponent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

vi.mock("../../SuggestedContent", () => ({
  DiffRenderer: ({
    oldContent,
    newContent,
  }: {
    oldContent: string;
    newContent: string;
  }) => (
    <div data-testid="diff">
      <span data-testid="diff-old">{oldContent}</span>
      <span data-testid="diff-new">{newContent}</span>
    </div>
  ),
}));

const task = (id: string): TaskResponseDto =>
  ({
    id,
    name: "Current task title",
    type: "STANDARD",
    status: "BACKLOG",
    organizationId: "org-1",
    projectId: "project-1",
    sections: [],
  }) as TaskResponseDto;

const proposal = (
  updates: Record<string, unknown>,
  overrides: Partial<ProposalResponseDto> = {},
): ProposalResponseDto =>
  ({
    id: "proposal-1",
    organizationId: "org-1",
    projectId: "project-1",
    type: ProposalType.Single,
    action: ProposalAction.Update,
    status: ProposalStatus.Pending,
    targetEntityId: "task-1",
    targetEntityType: TargetEntityType.Task,
    title: "Current task title",
    updates,
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-08-18T00:00:00Z",
    updatedAt: "2026-08-18T00:00:00Z",
    ...overrides,
  }) as ProposalResponseDto;

const edge = {
  targetEntityId: "task-2",
  targetEntityType: ProposalEdgeTargetType.Task,
  targetEntityTitle: "Effective entity prompt template",
  edgeType: ProposalEdgeType.DependsOn,
  description: "Uses the published template boundary.",
};

beforeEach(() => {
  vi.clearAllMocks();
  getTaskMock.mockImplementation(() => new Promise(() => {}));
  Object.keys(entities).forEach((key) => delete entities[key]);
  entities["task-1"] = { type: "task", data: task("task-1") };
  useEntityDataMock.mockReturnValue({
    entities,
    loading: false,
    error: null,
  });
});

const renderUpdates = (
  currentProposals: ProposalResponseDto[],
  renderMode?: "standalone" | "group-member",
) =>
  render(
    <MemoryRouter>
      <UpdateProposal
        proposals={currentProposals}
        allProposals={currentProposals}
        organizationId="org-1"
        projectId="project-1"
        onApply={async () => undefined}
        renderMode={renderMode}
      />
    </MemoryRouter>,
  );

const renderUpdate = (
  currentProposal: ProposalResponseDto,
  renderMode?: "standalone" | "group-member",
) => renderUpdates([currentProposal], renderMode);

describe("UpdateProposal edge declarations", () => {
  it("renders an edge-only update without hydrating the target entity", () => {
    renderUpdate(proposal({}, { edges: [edge] }));

    expect(screen.getByTestId("edge-only-update-proposal")).toBeInTheDocument();
    expect(screen.getByText("Relationships")).toBeInTheDocument();
    expect(screen.getByText("depends on")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Effective entity prompt template" }),
    ).toHaveAttribute("href", "/tasks/task-2");
    expect(screen.queryByText("task-2")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Uses the published template boundary\./),
    ).toBeInTheDocument();
    expect(useEntityDataMock).toHaveBeenCalledWith(
      [],
      "org-1",
      "project-1",
      "live",
    );
  });

  it("uses the target entity presentation for non-task edge-only updates", () => {
    renderUpdate(
      proposal(
        {},
        {
          targetEntityType: TargetEntityType.DesignDoc,
          edges: [edge],
        },
      ),
    );

    expect(screen.getByTestId("proposal-header-type")).toHaveTextContent(
      "Design doc",
    );
    expect(screen.getByTestId("proposal-header-type")).not.toHaveTextContent(
      "DESIGN_DOC",
    );
  });

  it("renders ordinary changes and declared edges exactly once", () => {
    renderUpdate(proposal({ name: "Renamed task" }, { edges: [edge] }));

    expect(screen.getByTestId("diff-new")).toHaveTextContent("Renamed task");
    expect(screen.getAllByText("Relationships")).toHaveLength(1);
    expect(
      screen.getAllByText("Effective entity prompt template"),
    ).toHaveLength(1);
  });

  it("renders an edge-only update in group-member mode without its own header", () => {
    renderUpdate(proposal({}, { edges: [edge] }), "group-member");

    expect(screen.getByText("Relationships")).toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-identity-header"),
    ).not.toBeInTheDocument();
  });

  it("renders an edge-only update while an entity-backed sibling is loading", () => {
    useEntityDataMock.mockReturnValue({
      entities: {},
      loading: true,
      error: null,
    });

    renderUpdates([
      proposal({}, { id: "proposal-edge", edges: [edge] }),
      proposal(
        { name: "Renamed task" },
        { id: "proposal-entity", targetEntityId: "task-3" },
      ),
    ]);

    expect(screen.getByTestId("edge-only-update-proposal")).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });

  it("renders an edge-only update when an entity-backed sibling fails to load", () => {
    useEntityDataMock.mockReturnValue({
      entities: {},
      loading: false,
      error: "Entity fetch failed",
    });

    renderUpdates([
      proposal({}, { id: "proposal-edge", edges: [edge] }),
      proposal(
        { name: "Renamed task" },
        { id: "proposal-entity", targetEntityId: "task-3" },
      ),
    ]);

    expect(screen.getByTestId("edge-only-update-proposal")).toBeInTheDocument();
    expect(screen.getByText("Entity fetch failed")).toBeInTheDocument();
  });

  it("preserves the existing zero-edge update path", () => {
    renderUpdate(proposal({ name: "Renamed task" }));

    expect(screen.getByTestId("diff")).toBeInTheDocument();
    expect(screen.queryByText("Relationships")).not.toBeInTheDocument();
    expect(useEntityDataMock).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "proposal-1" })]),
      "org-1",
      "project-1",
      "live",
    );
  });

  it("shows resulting Feature availability for an edge-only Agent Mode update", async () => {
    getTaskMock.mockImplementation(async ({ taskId }: { taskId: string }) => ({
      data: {
        data:
          taskId === "mode-1"
            ? {
                ...task("mode-1"),
                type: "MODE",
                edges: [
                  {
                    id: "persisted-feature-dependency",
                    sourceNodeId: "mode-1",
                    targetNodeId: "feature-existing",
                    sourceEntityType: AgentEdgeEndpointEntityType.Task,
                    targetEntityType: AgentEdgeEndpointEntityType.Task,
                    targetNodeType: "FEATURE",
                    targetNodeName: "Existing Feature",
                    type: AgentEdgeType.DependsOn,
                    reasoning: "",
                    createdAt: "2026-01-01T00:00:00Z",
                    updatedAt: "2026-01-01T00:00:00Z",
                  } satisfies AgentEdgeResponseDto,
                ],
              }
            : {
                id: taskId,
                name:
                  taskId === "feature-existing"
                    ? "Existing Feature"
                    : "New Feature",
                type: "FEATURE",
              },
      },
    }));

    renderUpdate(
      proposal(
        {},
        {
          id: "mode-edge-only",
          targetEntityId: "mode-1",
          edges: [
            {
              targetEntityId: "feature-new",
              targetEntityType: ProposalEdgeTargetType.Task,
              targetEntityTitle: "New Feature",
              edgeType: ProposalEdgeType.DependsOn,
            },
          ],
        },
      ),
    );

    const availability = await screen.findByTestId("mode-availability-summary");
    await within(availability).findByRole("link", {
      name: "Existing Feature",
    });
    expect(
      within(availability).getByRole("link", { name: "Existing Feature" }),
    ).toHaveAttribute("href", "/features/feature-existing");
    expect(
      within(availability).getByRole("link", { name: "New Feature" }),
    ).toHaveAttribute("href", "/features/feature-new");
    expect(screen.getByText("Relationships")).toBeInTheDocument();
  });
});
