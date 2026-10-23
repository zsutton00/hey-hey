import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  ProposalEdgeTargetType,
  ProposalEdgeType,
} from "../../../api";
import type {
  AgentEdgeResponseDto,
  ProposalEdgeDeclaration,
  TaskResponseDto,
} from "../../../api";
import {
  collectModeFeatureDependencyCandidates,
  projectModeAvailabilityFeatures,
  type ModeAvailabilityState,
} from "../modeAvailability";
import { ModeAvailabilitySummary } from "../ModeAvailabilitySummary";

vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    feature: ({
      projectId,
      featureId,
    }: {
      projectId: string;
      featureId: string;
    }) => `/projects/${projectId}/features/${featureId}`,
  }),
}));

vi.mock("../../SmarterTextAreaCard/EntityHoverCard", () => ({
  EntityHoverCard: () => null,
}));

const renderSummary = (availability: ModeAvailabilityState) =>
  render(
    <MemoryRouter>
      <ModeAvailabilitySummary
        availability={availability}
        organizationId="org-1"
        projectId="project-1"
      />
    </MemoryRouter>
  );

const persistedEdge = (
  overrides: Partial<AgentEdgeResponseDto>
): AgentEdgeResponseDto =>
  ({
    id: "edge-1",
    sourceNodeId: "mode-1",
    targetNodeId: "feature-1",
    sourceEntityType: AgentEdgeEndpointEntityType.Task,
    targetEntityType: AgentEdgeEndpointEntityType.Task,
    targetNodeType: "FEATURE",
    targetNodeName: "Reporting",
    type: AgentEdgeType.DependsOn,
    reasoning: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as AgentEdgeResponseDto);

const declaredEdge = (
  overrides: Partial<ProposalEdgeDeclaration>
): ProposalEdgeDeclaration =>
  ({
    targetEntityId: "feature-1",
    targetEntityType: ProposalEdgeTargetType.Task,
    edgeType: ProposalEdgeType.DependsOn,
    ...overrides,
  } as ProposalEdgeDeclaration);

describe("ModeAvailabilitySummary", () => {
  it("states when the mode is available project-wide", () => {
    renderSummary({ kind: "ready", features: [] });

    expect(screen.getByText("Available project-wide")).toBeInTheDocument();
  });

  it("links one or more named Features and says descendants are included", () => {
    renderSummary({
      kind: "ready",
      features: [
        { id: "feature-1", name: "Reporting" },
        { id: "feature-2", name: "Team Collaboration" },
      ],
    });

    expect(
      screen.getByText("Available in these Features and their descendants:")
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reporting" })).toHaveAttribute(
      "href",
      "/projects/project-1/features/feature-1"
    );
    expect(
      screen.getByRole("link", { name: "Team Collaboration" })
    ).toHaveAttribute("href", "/projects/project-1/features/feature-2");
  });

  it("shows loading and error states without claiming project-wide scope", () => {
    const { rerender } = renderSummary({ kind: "loading" });
    expect(screen.getByTestId("mode-availability-loading")).toBeInTheDocument();
    expect(
      screen.queryByText("Available project-wide")
    ).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ModeAvailabilitySummary
          availability={{ kind: "error" }}
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("mode-availability-error")).toHaveTextContent(
      "Feature availability could not be determined."
    );
    expect(
      screen.queryByText("Available project-wide")
    ).not.toBeInTheDocument();
  });
});

describe("mode Feature dependency projection", () => {
  it("keeps only outbound DEPENDS_ON task targets resolved as Features and deduplicates IDs", () => {
    const candidates = collectModeFeatureDependencyCandidates(
      "mode-1",
      [
        persistedEdge({ targetNodeId: "feature-1" }),
        persistedEdge({
          id: "incoming",
          sourceNodeId: "feature-2",
          targetNodeId: "mode-1",
        }),
        persistedEdge({
          id: "related",
          targetNodeId: "feature-related",
          type: AgentEdgeType.RelatedTo,
        }),
        persistedEdge({
          id: "ordinary-dependency",
          targetNodeId: "task-existing",
          targetNodeType: "STANDARD",
          targetNodeName: "Ordinary task",
        }),
      ],
      [
        declaredEdge({ targetEntityId: "feature-1" }),
        declaredEdge({ targetEntityId: "feature-2" }),
        declaredEdge({
          targetEntityId: "task-1",
          targetEntityTitle: "Ordinary task",
        }),
        declaredEdge({
          targetEntityId: "feature-related",
          edgeType: ProposalEdgeType.RelatedTo,
        }),
        declaredEdge({
          targetEntityId: "design-doc-1",
          targetEntityType: ProposalEdgeTargetType.DesignDoc,
        }),
        declaredEdge({
          targetEntityId: "proposal-1",
          targetEntityType: ProposalEdgeTargetType.Proposal,
        }),
      ]
    );

    expect(candidates.map(({ id }) => id)).toEqual([
      "feature-1",
      "feature-2",
      "task-1",
    ]);

    const tasks = new Map<string, TaskResponseDto>([
      [
        "feature-1",
        {
          id: "feature-1",
          name: "Reporting",
          type: "FEATURE",
        } as TaskResponseDto,
      ],
      [
        "feature-2",
        {
          id: "feature-2",
          name: "Planning",
          type: "FEATURE",
        } as TaskResponseDto,
      ],
      [
        "task-1",
        {
          id: "task-1",
          name: "Ordinary task",
          type: "STANDARD",
        } as TaskResponseDto,
      ],
    ]);

    expect(projectModeAvailabilityFeatures(candidates, tasks)).toEqual([
      { id: "feature-1", name: "Reporting" },
      { id: "feature-2", name: "Planning" },
    ]);
  });
});
