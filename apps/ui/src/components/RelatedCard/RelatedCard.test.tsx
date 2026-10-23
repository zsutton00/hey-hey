import {
  type ContextRelatedEntityDto,
  type EdgeSource,
  type EntityContextDtoProposalsInner,
  type Influence,
  type ProposalResponseDto,
} from "@hey-hey/ui-common/api";
import { render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { RelatedCard } from "./RelatedCard";

vi.mock("@hey-hey/ui-common/components", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/components")
  >("@hey-hey/ui-common/components");
  return {
    Card: actual.Card,
    EntityIcon: ({ entityType }: { entityType: string }) => (
      <span data-testid="entity-icon" data-entity-type={entityType}>
        {entityType}
      </span>
    ),
    EntityNodeStatusChip: ({ status }: { status?: string }) =>
      status ? <span data-testid="entity-status">{status}</span> : null,
    formatRelationshipLabel: actual.formatRelationshipLabel,
    isRelationshipValue: actual.isRelationshipValue,
    isVisualArtifactTypeKey: actual.isVisualArtifactTypeKey,
    isWorkflowFlowRelationship: actual.isWorkflowFlowRelationship,
  };
});

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [
      { definition: { key: "STANDARD", name: "Tasks" }, isSystem: true },
      { definition: { key: "BUG", name: "Bugs" }, isSystem: true },
      { definition: { key: "GOAL", name: "Goals" }, isSystem: true },
      { definition: { key: "FEATURE", name: "Features" }, isSystem: true },
      { definition: { key: "CONTRACT", name: "Contracts" }, isSystem: true },
      {
        definition: { key: "CONTRACT", name: "Contracts" },
        isSystem: false,
      },
      { definition: { key: "MARKETING", name: "Marketing" }, isSystem: false },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@hey-hey/ui-common/services", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/services")
  >("@hey-hey/ui-common/services");
  return {
    WebPathService: {
      conversation: actual.WebPathService.conversation,
      task: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
        `/projects/${projectId}/tasks/${taskId}`,
      designDoc: ({
        projectId,
        designDocId,
      }: {
        projectId: string;
        designDocId: string;
      }) => `/projects/${projectId}/documents/${designDocId}`,
      agentSession: ({
        projectId,
        agentSessionId,
      }: {
        projectId: string;
        agentSessionId: string;
      }) => `/projects/${projectId}/sessions/${agentSessionId}`,
      plan: ({ projectId, planId }: { projectId: string; planId: string }) =>
        `/projects/${projectId}/plans/${planId}`,
      service: ({
        projectId,
        serviceId,
      }: {
        projectId: string;
        serviceId: string;
      }) => `/projects/${projectId}/services/${serviceId}`,
      user: ({ projectId, userId }: { projectId: string; userId: string }) =>
        `/projects/${projectId}/users/${userId}`,
    },
  };
});

const buildRelated = (
  entityId: string,
  entityType: string,
  displayName: string,
  relationship = "RELATED_TO",
  source?: EdgeSource,
  taskType?: string
): ContextRelatedEntityDto => ({
  entityId,
  entityType,
  displayName,
  relationship,
  ...(source !== undefined ? { source } : {}),
  ...(taskType !== undefined ? { taskType } : {}),
});

const buildInfluence = (
  entityId: string,
  entityType: string,
  entityTitle: string | null = null,
  reasonType = "explicit_mention"
): Influence => ({
  entityId,
  entityType: entityType as Influence["entityType"],
  entityTitle,
  reasoning: "test reasoning",
  reasonType,
});

const buildProposal = (
  overrides: Partial<ProposalResponseDto> = {}
): ProposalResponseDto =>
  ({
    id: overrides.id ?? "proposal-1",
    organizationId: "org-1",
    projectId: "project-1",
    type: "SINGLE",
    action: "UPDATE",
    status: "APPROVED",
    targetEntityId: "task-target",
    targetEntityType: "TASK",
    updates: {},
    requestorId: "user-x",
    influences: [],
    approvals: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as unknown as ProposalResponseDto);

const renderCard = ({
  proposals = [],
  relatedEntities = [],
  dataTestId = "related-card",
  loading = false,
}: {
  proposals?: EntityContextDtoProposalsInner[];
  relatedEntities?: ContextRelatedEntityDto[];
  dataTestId?: string;
  loading?: boolean;
}): void => {
  render(
    <MemoryRouter>
      <RelatedCard
        proposals={proposals}
        relatedEntities={relatedEntities}
        organizationId="org-1"
        projectId="project-1"
        dataTestId={dataTestId}
        loading={loading}
      />
    </MemoryRouter>
  );
};

describe("RelatedCard", () => {
  it("renders an empty fallback when there is no data", () => {
    renderCard({});
    expect(screen.getByText("No related entities.")).toBeInTheDocument();
  });

  it("renders the outer card test id", () => {
    renderCard({});
    expect(screen.getByTestId("related-card")).toBeInTheDocument();
  });

  it("supports a custom dataTestId", () => {
    renderCard({ dataTestId: "task-sidebar-related-card" });
    expect(screen.getByTestId("task-sidebar-related-card")).toBeInTheDocument();
  });

  it("keeps the card shell mounted and shows progress while loading", () => {
    renderCard({ loading: true });

    expect(screen.getByTestId("related-card")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Related" })).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Loading related entities" })
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("related-card-content-state")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No related entities.")).not.toBeInTheDocument();
  });

  describe("Design Documents section", () => {
    it("renders DESIGN_DOC relatedEntities under the Design Documents section", () => {
      renderCard({
        relatedEntities: [
          buildRelated("doc-1", "DESIGN_DOC", "Doc One", "derives-from"),
          buildRelated("doc-2", "DESIGN_DOC", "Doc Two"),
        ],
      });

      const section = screen.getByTestId(
        "related-card-section-design-documents"
      );
      expect(within(section).getByText("Doc One")).toBeInTheDocument();
      expect(within(section).getByText("Doc Two")).toBeInTheDocument();
    });

    it("hides the Design Documents section when no DESIGN_DOC entities exist", () => {
      renderCard({
        relatedEntities: [buildRelated("task-1", "TASK", "Task One")],
      });

      expect(
        screen.queryByTestId("related-card-section-design-documents")
      ).not.toBeInTheDocument();
    });
  });

  describe("Tasks section", () => {
    it("renders TASK relatedEntities under the Tasks section", () => {
      renderCard({
        relatedEntities: [
          buildRelated("task-1", "TASK", "Task One", "depends-on"),
        ],
      });

      const section = screen.getByTestId("related-card-section-standard");
      expect(within(section).getByText("Task One")).toBeInTheDocument();
    });

    it("hides the Tasks section when no TASK entities exist", () => {
      renderCard({
        relatedEntities: [buildRelated("doc-1", "DESIGN_DOC", "Doc One")],
      });

      expect(
        screen.queryByTestId("related-card-section-standard")
      ).not.toBeInTheDocument();
    });

    it("hides a sibling-via-parent TASK that is not also a proposal influence", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "task-sib",
            "TASK",
            "Sibling Task",
            "sibling-via-parent"
          ),
        ],
      });

      expect(
        screen.queryByTestId("related-card-section-standard")
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Sibling Task")).not.toBeInTheDocument();
    });

    it("renders a sibling-via-parent TASK when it is also a proposal influence", () => {
      const proposal = buildProposal({
        id: "proposal-sib-influence",
        action: "UPDATE",
        influences: [buildInfluence("task-sib", "TASK", "Sibling Task")],
      });

      renderCard({
        proposals: [proposal],
        relatedEntities: [
          buildRelated(
            "task-sib",
            "TASK",
            "Sibling Task",
            "sibling-via-parent"
          ),
        ],
      });

      const section = screen.getByTestId("related-card-section-standard");
      expect(within(section).getByText("Sibling Task")).toBeInTheDocument();
    });

    it("renders a TASK with a non-sibling relationship", () => {
      renderCard({
        relatedEntities: [
          buildRelated("task-rel", "TASK", "Related Task", "related-to"),
        ],
      });

      const section = screen.getByTestId("related-card-section-standard");
      expect(within(section).getByText("Related Task")).toBeInTheDocument();
    });
  });

  describe("Other section", () => {
    it("includes non-DESIGN_DOC/non-TASK relatedEntities in Other", () => {
      renderCard({
        relatedEntities: [
          buildRelated("session-1", "AGENT_SESSION", "A Session"),
        ],
      });

      const section = screen.getByTestId("related-card-section-other");
      expect(within(section).getByText("A Session")).toBeInTheDocument();
    });

    it("includes user influences in Other with relative timestamps", () => {
      const proposal = buildProposal({
        id: "proposal-user",
        action: "UPDATE",
        createdAt: "2026-04-01T00:00:00Z",
        influences: [buildInfluence("user-1", "USER", "Alice", "user_reason")],
      });

      renderCard({ proposals: [proposal] });

      const section = screen.getByTestId("related-card-section-other");
      const row = within(section).getByTestId("related-card-row-user-user-1");
      expect(row).toHaveAttribute("href", "/projects/project-1/users/user-1");
      expect(within(row).getByText("Alice")).toBeInTheDocument();
      expect(within(row).getByText(/^Updated /)).toBeInTheDocument();
    });

    it("includes entity influences not already shown in another section", () => {
      const proposal = buildProposal({
        id: "proposal-influence",
        action: "UPDATE",
        influences: [
          buildInfluence("agent-1", "AGENT_SESSION", "An Agent Session"),
        ],
      });

      renderCard({ proposals: [proposal] });

      const section = screen.getByTestId("related-card-section-other");
      expect(within(section).getByText("An Agent Session")).toBeInTheDocument();
    });

    it("hides Other when there is nothing to surface", () => {
      renderCard({
        relatedEntities: [buildRelated("doc-1", "DESIGN_DOC", "Doc One")],
      });

      expect(
        screen.queryByTestId("related-card-section-other")
      ).not.toBeInTheDocument();
    });

    it("does not duplicate an entity already shown in Tasks or Design Documents", () => {
      const proposal = buildProposal({
        id: "proposal-dup",
        action: "UPDATE",
        influences: [buildInfluence("task-1", "TASK", "Task One")],
      });

      renderCard({
        proposals: [proposal],
        relatedEntities: [buildRelated("task-1", "TASK", "Task One")],
      });

      const rows = screen.getAllByTestId("related-card-row-task-1");
      expect(rows).toHaveLength(1);
      expect(
        screen.queryByTestId("related-card-section-other")
      ).not.toBeInTheDocument();
    });
  });

  describe("Work-item-type grouping", () => {
    it("prioritizes dependencies stably inside every configured and fallback type section", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "standard-related-1",
            "TASK",
            "Standard Related One",
            "related-to",
            undefined,
            "STANDARD"
          ),
          buildRelated(
            "standard-dependency-1",
            "TASK",
            "Standard Dependency One",
            "depends-on",
            undefined,
            "STANDARD"
          ),
          buildRelated(
            "standard-dependency-2",
            "TASK",
            "Standard Dependency Two",
            "depends-on",
            undefined,
            "STANDARD"
          ),
          buildRelated(
            "standard-related-2",
            "TASK",
            "Standard Related Two",
            "related-to",
            undefined,
            "STANDARD"
          ),
          buildRelated(
            "bug-related",
            "TASK",
            "Bug Related",
            "related-to",
            undefined,
            "BUG"
          ),
          buildRelated(
            "bug-dependency",
            "TASK",
            "Bug Dependency",
            "depends-on",
            undefined,
            "BUG"
          ),
          buildRelated(
            "unknown-related",
            "TASK",
            "Unknown Related",
            "related-to",
            undefined,
            "UNKNOWN"
          ),
          buildRelated(
            "unknown-dependency",
            "TASK",
            "Unknown Dependency",
            "depends-on",
            undefined,
            "UNKNOWN"
          ),
        ],
      });

      const rowNames = (sectionTestId: string): string[] =>
        within(screen.getByTestId(sectionTestId))
          .getAllByRole("link")
          .map((row) => row.textContent ?? "");

      expect(rowNames("related-card-section-standard")).toEqual([
        expect.stringContaining("Standard Dependency One"),
        expect.stringContaining("Standard Dependency Two"),
        expect.stringContaining("Standard Related One"),
        expect.stringContaining("Standard Related Two"),
      ]);
      expect(rowNames("related-card-section-bug")).toEqual([
        expect.stringContaining("Bug Dependency"),
        expect.stringContaining("Bug Related"),
      ]);
      expect(rowNames("related-card-section-unknown")).toEqual([
        expect.stringContaining("Unknown Dependency"),
        expect.stringContaining("Unknown Related"),
      ]);
    });

    it("applies warning styling only to Depends on chips", () => {
      renderCard({
        relatedEntities: [
          buildRelated("task-multi", "TASK", "Multi Task", "related-to"),
          buildRelated("task-multi", "TASK", "Multi Task", "depends-on"),
          buildRelated("task-multi", "TASK", "Multi Task", "derives-from"),
        ],
      });

      const row = screen.getByTestId("related-card-row-task-multi");
      expect(
        within(row).getByText("Depends on").closest(".MuiChip-root")
      ).toHaveClass("MuiChip-colorWarning");
      expect(
        within(row).getByText("Related to").closest(".MuiChip-root")
      ).toHaveClass("MuiChip-colorDefault");
      expect(
        within(row).getByText("Derives from").closest(".MuiChip-root")
      ).toHaveClass("MuiChip-colorDefault");
    });

    it("groups TASK entries into per-type sections in registry order, preserving relationship labels, with Design Documents and Other at the tail and Created Together left to History", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "task-standard",
            "TASK",
            "Standard Task",
            "mentions",
            undefined,
            "STANDARD"
          ),
          buildRelated(
            "task-bug",
            "TASK",
            "A Bug",
            "depends-on",
            undefined,
            "BUG"
          ),
          buildRelated(
            "task-marketing",
            "TASK",
            "A Campaign",
            "related-to",
            undefined,
            "MARKETING"
          ),
          buildRelated("doc-1", "DESIGN_DOC", "Doc One", "derives-from"),
          buildRelated("session-1", "AGENT_SESSION", "A Session"),
          buildRelated(
            "workflow-step-standard",
            "TASK",
            "Workflow Standard Step",
            "standard",
            undefined,
            "workflow_step"
          ),
          buildRelated(
            "workflow-step-conditional",
            "TASK",
            "Workflow Conditional Step",
            "CONDITIONAL",
            undefined,
            "workflow_step"
          ),
          buildRelated(
            "workflow-loop-fallback",
            "AGENT_SESSION",
            "Workflow Loop Fallback",
            "loop"
          ),
          buildRelated(
            "task-co",
            "TASK",
            "Co-Proposed Task",
            "proposed-together",
            undefined,
            "STANDARD"
          ),
        ],
      });

      // (a) STANDARD lands in its own Tasks group.
      const standardSection = screen.getByTestId(
        "related-card-section-standard"
      );
      expect(
        within(standardSection).getByText("Standard Task")
      ).toBeInTheDocument();
      // (d) relationship-kind label still renders inside the group.
      expect(within(standardSection).getByText("Mentions")).toBeInTheDocument();

      // (b) BUG lands in a Bugs group.
      const bugSection = screen.getByTestId("related-card-section-bug");
      expect(within(bugSection).getByText("A Bug")).toBeInTheDocument();
      expect(within(bugSection).getByText("Depends on")).toBeInTheDocument();

      // (c) the custom MARKETING entry lands in its own Marketing group.
      const marketingSection = screen.getByTestId(
        "related-card-section-marketing"
      );
      expect(
        within(marketingSection).getByText("A Campaign")
      ).toBeInTheDocument();
      expect(
        within(marketingSection).getByText("Related to")
      ).toBeInTheDocument();

      // (e) Design Documents and Other sections still render at the tail.
      const docSection = screen.getByTestId(
        "related-card-section-design-documents"
      );
      expect(within(docSection).getByText("Doc One")).toBeInTheDocument();
      const otherSection = screen.getByTestId("related-card-section-other");
      expect(within(otherSection).getByText("A Session")).toBeInTheDocument();
      expect(
        screen.queryByText("Workflow Standard Step")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Workflow Conditional Step")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Workflow Loop Fallback")
      ).not.toBeInTheDocument();

      // (f) Created Together entries belong to the History card.
      expect(screen.queryByText("Co-Proposed Task")).not.toBeInTheDocument();
    });

    it("renders the Tasks group title from the registry snapshot, not a hardcoded literal", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "task-1",
            "TASK",
            "Task One",
            "related-to",
            undefined,
            "STANDARD"
          ),
        ],
      });

      const section = screen.getByTestId("related-card-section-standard");
      expect(within(section).getByText("Tasks")).toBeInTheDocument();
    });

    it("buckets a TASK with no taskType under STANDARD so unmigrated entries still render", () => {
      renderCard({
        relatedEntities: [buildRelated("task-legacy", "TASK", "Legacy Task")],
      });

      const section = screen.getByTestId("related-card-section-standard");
      expect(within(section).getByText("Legacy Task")).toBeInTheDocument();
    });

    it("renders one section when the registry contains duplicate definitions for a type", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "contract-1",
            "TASK",
            "Contract One",
            "related-to",
            undefined,
            "CONTRACT"
          ),
          buildRelated(
            "contract-2",
            "TASK",
            "Contract Two",
            "depends-on",
            undefined,
            "CONTRACT"
          ),
        ],
      });

      const sections = screen.getAllByTestId("related-card-section-contract");
      expect(sections).toHaveLength(1);
      expect(within(sections[0]).getByText("Contracts")).toBeInTheDocument();
      expect(within(sections[0]).getByText("Contract One")).toBeInTheDocument();
      expect(within(sections[0]).getByText("Contract Two")).toBeInTheDocument();
    });
  });

  describe("Curated relationship labels", () => {
    it("renders curated labels (sentence case) for known RelationshipValue strings", () => {
      renderCard({
        relatedEntities: [
          buildRelated("task-1", "TASK", "Task One", "depends-on"),
          buildRelated("doc-1", "DESIGN_DOC", "Doc One", "derives-from"),
        ],
      });

      const taskRow = screen.getByTestId("related-card-row-task-1");
      expect(within(taskRow).getByText("Depends on")).toBeInTheDocument();
      expect(within(taskRow).queryByText("Depends On")).not.toBeInTheDocument();

      const docRow = screen.getByTestId("related-card-row-doc-1");
      expect(within(docRow).getByText("Derives from")).toBeInTheDocument();
      expect(
        within(docRow).queryByText("Derives From")
      ).not.toBeInTheDocument();
    });
  });

  describe("Work-item type icons", () => {
    it.each([
      ["STANDARD", "TASK"],
      ["BUG", "BUG"],
      ["GOAL", "GOAL"],
      ["FEATURE", "FEATURE"],
      ["MARKETING", "MARKETING"],
    ])(
      "renders the registry icon discriminator for %s",
      (taskType, iconType) => {
        renderCard({
          relatedEntities: [
            buildRelated(
              `task-${taskType.toLowerCase()}`,
              "TASK",
              `${taskType} item`,
              "related-to",
              undefined,
              taskType
            ),
          ],
        });

        expect(screen.getByTestId("entity-icon")).toHaveAttribute(
          "data-entity-type",
          iconType
        );
      }
    );

    it("uses the STANDARD icon for a legacy entry without taskType", () => {
      renderCard({
        relatedEntities: [buildRelated("task-legacy", "TASK", "Legacy task")],
      });

      expect(screen.getByTestId("entity-icon")).toHaveAttribute(
        "data-entity-type",
        "TASK"
      );
    });

    it("withholds the type-specific icon when the definition is unavailable", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "task-unknown",
            "TASK",
            "Unknown item",
            "related-to",
            undefined,
            "UNKNOWN"
          ),
        ],
      });

      expect(screen.queryByTestId("entity-icon")).not.toBeInTheDocument();
      expect(screen.getByText("Unknown item")).toBeInTheDocument();
    });

    it.each(["feature-related-card", "task-sidebar-related-card"])(
      "preserves taskType-aware icons through the %s consumer boundary",
      (dataTestId) => {
        renderCard({
          dataTestId,
          relatedEntities: [
            buildRelated(
              "task-bug",
              "TASK",
              "Consumer bug",
              "related-to",
              undefined,
              "BUG"
            ),
          ],
        });

        expect(
          within(screen.getByTestId(dataTestId)).getByTestId("entity-icon")
        ).toHaveAttribute("data-entity-type", "BUG");
      }
    );
  });

  describe("Source affordance", () => {
    it("renders the agent affordance when source is agent", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "task-1",
            "TASK",
            "Task One",
            "depends-on",
            "agent" as EdgeSource
          ),
        ],
      });

      expect(
        screen.getByTestId("related-card-row-task-1-agent-source")
      ).toBeInTheDocument();
    });

    it("renders the agent affordance when source is absent", () => {
      renderCard({
        relatedEntities: [
          buildRelated("task-1", "TASK", "Task One", "depends-on"),
        ],
      });

      expect(
        screen.getByTestId("related-card-row-task-1-agent-source")
      ).toBeInTheDocument();
    });

    it("does not render the agent affordance when source is system", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "task-1",
            "TASK",
            "Task One",
            "depends-on",
            "system" as EdgeSource
          ),
        ],
      });

      expect(
        screen.queryByTestId("related-card-row-task-1-agent-source")
      ).not.toBeInTheDocument();
    });
  });

  describe("Rows owned by other rail cards", () => {
    it("omits Mockup and Diagram rows, which render as visual cards", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "mock-1",
            "TASK",
            "Login Mockup",
            "related-to",
            undefined,
            "mockup"
          ),
          buildRelated(
            "diag-1",
            "TASK",
            "System Diagram",
            "related-to",
            undefined,
            "DIAGRAM"
          ),
          buildRelated(
            "task-1",
            "TASK",
            "Task One",
            "related-to",
            undefined,
            "STANDARD"
          ),
        ],
      });
      expect(screen.queryByText("Login Mockup")).not.toBeInTheDocument();
      expect(screen.queryByText("System Diagram")).not.toBeInTheDocument();
      expect(screen.getByText("Task One")).toBeInTheDocument();
    });

    it("omits proposed-together entities, which render in History", () => {
      renderCard({
        relatedEntities: [
          buildRelated("task-multi", "TASK", "Multi Task", "proposed-together"),
          buildRelated("task-multi", "TASK", "Multi Task", "depends-on"),
        ],
      });
      expect(screen.queryByText("Multi Task")).not.toBeInTheDocument();
      expect(screen.getByText("No related entities.")).toBeInTheDocument();
    });

    it("does not render Origin or Last Updated sections", () => {
      renderCard({
        proposals: [
          buildProposal({
            id: "create",
            action: "CREATE",
            conversationId: "c1",
          }),
          buildProposal({
            id: "update",
            action: "UPDATE",
            conversationId: "c2",
          }),
        ],
      });
      expect(
        screen.queryByTestId("related-card-section-origin")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("related-card-section-last-updated")
      ).not.toBeInTheDocument();
    });
  });
});
