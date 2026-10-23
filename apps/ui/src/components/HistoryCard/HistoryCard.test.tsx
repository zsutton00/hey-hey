import { WebPathService } from "@hey-hey/ui-common/services";
import {
  type ContextProposalSummaryDto,
  type ContextRelatedEntityDto,
  type EdgeSource,
  type EntityContextDtoProposalsInner,
  type Influence,
  type ProposalResponseDto,
} from "@hey-hey/ui-common/api";
import { TERMS } from "@hey-hey/ui-common/i18n";
import { render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { HistoryCard } from "./HistoryCard";

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

const buildProposalSummary = (
  overrides: Partial<ContextProposalSummaryDto> = {}
): ContextProposalSummaryDto =>
  ({
    id: overrides.id ?? "proposal-summary-1",
    organizationId: "org-1",
    projectId: "project-1",
    type: "SINGLE",
    action: "UPDATE",
    status: "APPROVED",
    targetEntityId: "task-target",
    targetEntityType: "TASK",
    requestorId: "user-x",
    requiredApprovals: 1,
    influences: [],
    approvals: [],
    changes: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as unknown as ContextProposalSummaryDto);

const conversationPathForId = (conversationId: string): string =>
  WebPathService.conversation({ projectId: "project-1", conversationId });

const renderCard = ({
  proposals = [],
  relatedEntities = [],
  dataTestId = "history-card",
}: {
  proposals?: EntityContextDtoProposalsInner[];
  relatedEntities?: ContextRelatedEntityDto[];
  dataTestId?: string;
}): void => {
  render(
    <MemoryRouter>
      <HistoryCard
        proposals={proposals}
        relatedEntities={relatedEntities}
        organizationId="org-1"
        projectId="project-1"
        conversationPathForId={conversationPathForId}
        dataTestId={dataTestId}
      />
    </MemoryRouter>
  );
};

describe("HistoryCard", () => {
  it("renders an empty fallback when there is no history", () => {
    renderCard({});
    expect(screen.getByText("No history.")).toBeInTheDocument();
  });

  it("does not render edge-driven relationships outside Created Together", () => {
    renderCard({
      relatedEntities: [
        buildRelated("task-1", "TASK", "Task One", "depends-on"),
        buildRelated("doc-1", "DESIGN_DOC", "Doc One", "derives-from"),
      ],
    });
    expect(screen.queryByText("Task One")).not.toBeInTheDocument();
    expect(screen.queryByText("Doc One")).not.toBeInTheDocument();
  });

  describe("Origin section", () => {
    it("renders bounded context proposal summaries without full updates", () => {
      const proposal = buildProposalSummary({
        id: "create-summary",
        action: "CREATE",
        conversationId: "conv-summary-origin",
      });

      renderCard({ proposals: [proposal] });

      expect(screen.getByTestId("history-card-origin")).toHaveAttribute(
        "href",
        "/projects/project-1/resolve-agent-session/conv-summary-origin"
      );
    });

    it("renders Origin when a CREATE proposal exists and links to its conversation", () => {
      const proposal = buildProposal({
        id: "create-proposal",
        action: "CREATE",
        conversationId: "conv-origin",
        createdAt: "2026-01-01T00:00:00Z",
      });

      renderCard({ proposals: [proposal] });

      expect(
        screen.getByTestId("history-card-section-origin")
      ).toBeInTheDocument();
      const row = screen.getByTestId("history-card-origin");
      expect(row).toHaveAttribute(
        "href",
        "/projects/project-1/resolve-agent-session/conv-origin"
      );
    });

    it("renders the about-entity from the proposal's origin influence", () => {
      const proposal = buildProposal({
        id: "create-proposal",
        action: "CREATE",
        conversationId: "conv-origin",
        influences: [
          buildInfluence("task-source", "TASK", "Tasks UI", "origin"),
          buildInfluence("feat-1", "TASK", "Feature Page", "explicit_mention"),
        ],
      });

      renderCard({ proposals: [proposal] });

      const label = screen.getByTestId("history-card-origin-label");
      expect(label).toHaveTextContent("Conversation about Tasks UI");
      expect(screen.getByTestId("history-card-origin-about")).toHaveTextContent(
        "Tasks UI"
      );
    });

    it("falls back to the entity-type label when the origin influence has no entityTitle", () => {
      const proposal = buildProposal({
        id: "create-proposal",
        action: "CREATE",
        conversationId: "conv-origin",
        influences: [buildInfluence("task-source", "TASK", null, "origin")],
      });

      renderCard({ proposals: [proposal] });

      expect(screen.getByTestId("history-card-origin-label")).toHaveTextContent(
        `Conversation about ${TERMS.Task}`
      );
    });

    it("falls back to plain 'Conversation' when the proposal has no origin influence", () => {
      const proposal = buildProposal({
        id: "create-proposal",
        action: "CREATE",
        conversationId: "conv-origin",
        influences: [buildInfluence("feat-1", "TASK", "Feature Page")],
      });

      renderCard({ proposals: [proposal] });

      const label = screen.getByTestId("history-card-origin-label");
      expect(label).toHaveTextContent("Conversation");
      expect(label).not.toHaveTextContent("about");
      expect(
        screen.queryByTestId("history-card-origin-about")
      ).not.toBeInTheDocument();
    });

    it("omits Origin when no CREATE proposal exists", () => {
      const proposal = buildProposal({
        id: "update-proposal",
        action: "UPDATE",
        conversationId: "conv-1",
      });

      renderCard({ proposals: [proposal] });

      expect(
        screen.queryByTestId("history-card-section-origin")
      ).not.toBeInTheDocument();
    });
  });

  describe("Last Updated section", () => {
    it("renders Last Updated for the most-recent UPDATE proposal", () => {
      const create = buildProposal({
        id: "create-1",
        action: "CREATE",
        conversationId: "conv-create",
        createdAt: "2026-01-01T00:00:00Z",
      });
      const earlierUpdate = buildProposal({
        id: "update-1",
        action: "UPDATE",
        conversationId: "conv-update-old",
        createdAt: "2026-02-01T00:00:00Z",
      });
      const latestUpdate = buildProposal({
        id: "update-2",
        action: "UPDATE",
        conversationId: "conv-update-latest",
        createdAt: "2026-03-01T00:00:00Z",
      });

      renderCard({ proposals: [create, earlierUpdate, latestUpdate] });

      const row = screen.getByTestId("history-card-last-updated");
      expect(row).toHaveAttribute(
        "href",
        "/projects/project-1/resolve-agent-session/conv-update-latest"
      );
    });

    it("renders the about-entity in the Last Updated row from its proposal's origin influence", () => {
      const create = buildProposal({
        id: "create-1",
        action: "CREATE",
        conversationId: "conv-create",
        createdAt: "2026-01-01T00:00:00Z",
        influences: [
          buildInfluence("feature-source", "TASK", "Feature Page", "origin"),
        ],
      });
      const latestUpdate = buildProposal({
        id: "update-2",
        action: "UPDATE",
        conversationId: "conv-update-latest",
        createdAt: "2026-03-01T00:00:00Z",
        influences: [
          buildInfluence(
            "initiative-source",
            "INITIATIVE",
            "Onboarding",
            "origin"
          ),
        ],
      });

      renderCard({ proposals: [create, latestUpdate] });

      expect(
        screen.getByTestId("history-card-last-updated-label")
      ).toHaveTextContent("Conversation about Onboarding");
      expect(screen.getByTestId("history-card-origin-label")).toHaveTextContent(
        "Conversation about Feature Page"
      );
    });

    it("hides Last Updated when the latest UPDATE shares a conversationId with the CREATE proposal", () => {
      const create = buildProposal({
        id: "create-1",
        action: "CREATE",
        conversationId: "conv-shared",
        createdAt: "2026-01-01T00:00:00Z",
      });
      const update = buildProposal({
        id: "update-1",
        action: "UPDATE",
        conversationId: "conv-shared",
        createdAt: "2026-02-01T00:00:00Z",
      });

      renderCard({ proposals: [create, update] });

      expect(
        screen.queryByTestId("history-card-section-last-updated")
      ).not.toBeInTheDocument();
    });

    it("hides Last Updated when there is no UPDATE proposal", () => {
      const create = buildProposal({
        id: "create-1",
        action: "CREATE",
        conversationId: "conv-create",
      });

      renderCard({ proposals: [create] });

      expect(
        screen.queryByTestId("history-card-section-last-updated")
      ).not.toBeInTheDocument();
    });
  });

  describe("Created Together section", () => {
    it("renders entities tagged proposed-together under Created Together", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "task-pt",
            "TASK",
            "Co-Proposed Task",
            "proposed-together"
          ),
        ],
      });

      const section = screen.getByTestId(
        "history-card-section-proposed-together"
      );
      expect(within(section).getByText("Co-Proposed Task")).toBeInTheDocument();
    });

    it("omits the Created Together section when no proposed-together edges exist", () => {
      renderCard({
        relatedEntities: [
          buildRelated("task-1", "TASK", "Task One", "depends-on"),
        ],
      });

      expect(
        screen.queryByTestId("history-card-section-proposed-together")
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Task One")).not.toBeInTheDocument();
    });

    it("merges proposed-together with other edges on the same entity, lists both labels with Created Together first, and renders the row once", () => {
      renderCard({
        relatedEntities: [
          buildRelated("task-multi", "TASK", "Multi Task", "proposed-together"),
          buildRelated("task-multi", "TASK", "Multi Task", "depends-on"),
        ],
      });

      const section = screen.getByTestId(
        "history-card-section-proposed-together"
      );
      const row = within(section).getByTestId("history-card-row-task-multi");
      expect(row).toBeInTheDocument();

      const chips = within(row).getAllByText(/Created together|Depends on/);
      expect(chips[0]).toHaveTextContent("Created together");
      expect(chips[1]).toHaveTextContent("Depends on");
      expect(chips[0].closest(".MuiChip-root")).toHaveClass(
        "MuiChip-colorDefault"
      );
      expect(chips[1].closest(".MuiChip-root")).toHaveClass(
        "MuiChip-colorWarning"
      );
      expect(screen.getAllByTestId("history-card-row-task-multi")).toHaveLength(
        1
      );
    });

    it("still suppresses a sibling-via-parent row that is neither proposed-together nor a proposal influence", () => {
      renderCard({
        relatedEntities: [
          buildRelated(
            "task-sib",
            "TASK",
            "Sibling Task",
            "sibling-via-parent"
          ),
          buildRelated(
            "task-pt",
            "TASK",
            "Co-Proposed Task",
            "proposed-together"
          ),
        ],
      });

      const ptSection = screen.getByTestId(
        "history-card-section-proposed-together"
      );
      expect(
        within(ptSection).getByText("Co-Proposed Task")
      ).toBeInTheDocument();
      expect(screen.queryByText("Sibling Task")).not.toBeInTheDocument();
    });
  });
});
