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
} from "../../../api";
import type {
  AgentEdgeResponseDto,
  ProposalResponseDto,
  TaskResponseDto,
  WorkItemTypeDefinitionDto,
} from "../../../api";
import { TaskUpdateRenderer } from "../TaskUpdateRenderer";
import type { UpdateTaskProposalUpdates } from "../types";

const getTaskMock = vi.hoisted(() => vi.fn());

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getTask: getTaskMock },
}));

const { featureLookup } = vi.hoisted(() => ({
  featureLookup: { isLoading: false, isReady: true, get: () => undefined },
}));
vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureLookup: () => featureLookup,
}));

vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    feature: ({ featureId }: { featureId: string }) => `/features/${featureId}`,
    task: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
  }),
}));

vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: undefined }),
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({ services: [], isLoading: false, error: null }),
}));

vi.mock("../../Selectors/TaskTreePicker", () => ({
  TaskTreePicker: () => <div data-testid="task-tree-picker" />,
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("../ProposalStateIndicator", () => ({
  ProposalStateIndicator: () => <div data-testid="proposal-state" />,
}));

vi.mock("../../SuggestedContent", () => ({
  DiffRenderer: ({ newContent }: { newContent: string }) => (
    <div data-testid="diff-renderer">{newContent}</div>
  ),
}));

vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: () => null,
}));

const modeId = "mode-1";
const makeGraphEdge = (
  overrides: Partial<AgentEdgeResponseDto>
): AgentEdgeResponseDto =>
  ({
    id: "edge-1",
    sourceNodeId: modeId,
    targetNodeId: "feature-existing",
    sourceEntityType: AgentEdgeEndpointEntityType.Task,
    targetEntityType: AgentEdgeEndpointEntityType.Task,
    targetNodeType: "FEATURE",
    targetNodeName: "Existing Feature",
    type: AgentEdgeType.DependsOn,
    reasoning: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as AgentEdgeResponseDto);

const existing: TaskResponseDto = {
  id: modeId,
  name: "Agent Mode",
  type: "MODE",
  status: "ACTIVE",
  organizationId: "org-1",
  projectId: "project-1",
  sections: [
    { key: "description", materializedMarkdown: "Current mode guidance" },
  ],
} as TaskResponseDto;

const workItemTypeDefinition: WorkItemTypeDefinitionDto = {
  key: "MODE",
  name: "Agent Mode",
  sections: [{ key: "description", label: "Guidance" }],
  allowedStatuses: [],
};

const makeProposal = (): ProposalResponseDto =>
  ({
    id: "proposal-mode-update",
    organizationId: "org-1",
    projectId: "project-1",
    type: ProposalType.Single,
    action: ProposalAction.Update,
    status: ProposalStatus.Pending,
    targetEntityId: modeId,
    targetEntityType: TargetEntityType.Task,
    updates: {
      sections: [{ key: "description", content: "Updated mode guidance" }],
    },
    edges: [
      {
        targetEntityId: "feature-new",
        targetEntityType: ProposalEdgeTargetType.Task,
        targetEntityTitle: "New Feature",
        edgeType: ProposalEdgeType.DependsOn,
      },
      {
        targetEntityId: "feature-existing",
        targetEntityType: ProposalEdgeTargetType.Task,
        targetEntityTitle: "Existing Feature",
        edgeType: ProposalEdgeType.DependsOn,
      },
      {
        targetEntityId: "feature-related",
        targetEntityType: ProposalEdgeTargetType.Task,
        targetEntityTitle: "Related Feature",
        edgeType: ProposalEdgeType.RelatedTo,
      },
      {
        targetEntityId: "task-proposed",
        targetEntityType: ProposalEdgeTargetType.Task,
        targetEntityTitle: "Ordinary task",
        edgeType: ProposalEdgeType.DependsOn,
      },
    ],
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  } as unknown as ProposalResponseDto);

const featureNames: Record<string, string> = {
  "feature-existing": "Existing Feature",
  "feature-new": "New Feature",
  "feature-related": "Related Feature",
};

beforeEach(() => {
  getTaskMock.mockReset();
  getTaskMock.mockImplementation(async ({ taskId }: { taskId: string }) => ({
    data: {
      data:
        taskId === modeId
          ? {
              ...existing,
              edges: [
                makeGraphEdge({ targetNodeId: "feature-existing" }),
                makeGraphEdge({
                  id: "incoming-feature",
                  sourceNodeId: "feature-related",
                  targetNodeId: modeId,
                }),
                makeGraphEdge({
                  id: "related-feature",
                  type: AgentEdgeType.RelatedTo,
                  targetNodeId: "feature-related",
                }),
                makeGraphEdge({
                  id: "ordinary-dependency",
                  targetNodeId: "task-existing",
                  targetNodeType: "STANDARD",
                  targetNodeName: "Ordinary task",
                }),
              ],
            }
          : taskId === "task-existing" || taskId === "task-proposed"
          ? { id: taskId, name: "Ordinary task", type: "STANDARD" }
          : {
              id: taskId,
              name: featureNames[taskId] ?? "Feature name unavailable",
              type: "FEATURE",
            },
    },
  }));
});

describe("TaskUpdateRenderer Agent Mode availability", () => {
  it("shows the resulting persisted and proposed Feature scope while preserving relationship details", async () => {
    render(
      <MemoryRouter>
        <TaskUpdateRenderer
          proposal={
            makeProposal() as ProposalResponseDto & {
              updates: UpdateTaskProposalUpdates;
            }
          }
          existing={existing}
          status={{ state: "pending" }}
          onApply={() => {}}
          siblingProposals={new Map()}
          workItemTypeDefinition={workItemTypeDefinition}
        />
      </MemoryRouter>
    );

    const featureLinks = await screen.findAllByTestId(
      "mode-availability-feature-link"
    );
    expect(featureLinks).toHaveLength(2);
    const availability = screen.getByTestId("mode-availability-summary");
    expect(
      within(availability).getByRole("link", { name: "Existing Feature" })
    ).toHaveAttribute("href", "/features/feature-existing");
    expect(
      within(availability).getByRole("link", { name: "New Feature" })
    ).toHaveAttribute("href", "/features/feature-new");
    expect(
      screen.queryByRole("link", { name: "Related Feature" })
    ).toBeInTheDocument();
    expect(screen.getByText("Relationships")).toBeInTheDocument();
    expect(screen.getByTestId("diff-renderer")).toHaveTextContent(
      "Updated mode guidance"
    );

    expect(getTaskMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: modeId,
      includeEdges: true,
      edgeTypes: [AgentEdgeType.DependsOn],
    });
    expect(getTaskMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "feature-existing",
    });
    expect(getTaskMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "feature-new",
    });
    expect(getTaskMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "task-proposed",
    });
  });
});
