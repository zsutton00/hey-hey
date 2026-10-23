import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  EntityType,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type Influence,
  type ProposalResponseDto,
} from "../../../api";
import { PathServiceProvider } from "../../../contexts/PathServiceContext";
import { getPathService } from "../../../services";
import { ProposalInfluencesBlock } from "../ProposalInfluencesBlock";

vi.mock("../../Entity", () => ({
  EntityLinkWithPreview: ({
    label,
    entityId,
    entityType,
  }: {
    label: string;
    entityId: string;
    entityType: string;
  }) => (
    <a
      data-testid="entity-link"
      data-entity-id={entityId}
      data-entity-type={entityType}
      href={`#${entityId}`}
    >
      {label}
    </a>
  ),
}));

const CONVERSATION_ID = "conv-xyz";
const PROJECT_ID = "proj-1";
const ORG_ID = "org-1";

const buildInfluence = (overrides: Partial<Influence> = {}): Influence => ({
  entityId: "ent-default",
  entityType: EntityType.Task,
  entityTitle: "Default Title",
  reasoning: "Default reasoning",
  reasonType: "explicit_mention",
  ...overrides,
});

const buildProposal = (
  influences: Influence[] | undefined,
  conversationIdOverride?: { conversationId?: string }
): ProposalResponseDto =>
  ({
    id: "prop-1",
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    conversationId: conversationIdOverride
      ? conversationIdOverride.conversationId
      : CONVERSATION_ID,
    action: ProposalAction.Update,
    status: ProposalStatus.Approved,
    type: ProposalType.TaskUpdate,
    targetEntityId: "tgt",
    targetEntityType: TargetEntityType.Task,
    updates: {},
    requestorId: "req-1",
    influences,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
  } as unknown as ProposalResponseDto);

const renderBlock = (proposal: ProposalResponseDto): void => {
  render(
    <MemoryRouter>
      <PathServiceProvider pathService={getPathService()}>
        <ProposalInfluencesBlock
          organizationId={ORG_ID}
          projectId={PROJECT_ID}
          proposal={proposal}
        />
      </PathServiceProvider>
    </MemoryRouter>
  );
};

describe("ProposalInfluencesBlock", () => {
  it("renders one row per influence with link, reason chip, and reasoning", () => {
    const influences: Influence[] = [
      buildInfluence({
        entityId: "feat-1",
        entityTitle: "Feature One",
        reasonType: "explicit_mention",
        reasoning: "Mentioned by author",
      }),
      buildInfluence({
        entityId: "feat-2",
        entityTitle: "Feature Two",
        reasonType: "derived",
        reasoning: "Pulled from sibling",
      }),
    ];

    renderBlock(buildProposal(influences));

    const links = screen.getAllByTestId("entity-link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("data-entity-id", "feat-1");
    expect(links[0]).toHaveTextContent("Feature One");
    expect(links[1]).toHaveAttribute("data-entity-id", "feat-2");
    expect(links[1]).toHaveTextContent("Feature Two");

    expect(
      screen.getByTestId("proposal-influence-chip-explicit_mention")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("proposal-influence-chip-derived")
    ).toBeInTheDocument();

    expect(screen.getByText("Mentioned by author")).toBeInTheDocument();
    expect(screen.getByText("Pulled from sibling")).toBeInTheDocument();
  });

  it("exposes a conversation link on the origin row when proposal.conversationId is set", () => {
    const influences: Influence[] = [
      buildInfluence({
        entityId: "conv-host",
        entityType: EntityType.Conversation,
        entityTitle: "Host Conversation",
        reasonType: "origin",
        reasoning: "Workflow about entity",
      }),
    ];

    renderBlock(buildProposal(influences));

    const originRow = screen.getByTestId("proposal-influence-origin");
    expect(originRow).toBeInTheDocument();

    const originChip = screen.getByTestId("proposal-influence-chip-origin");
    expect(originChip).toBeInTheDocument();

    const link = screen.getByTestId("proposal-influence-origin-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}/resolve-agent-session/${CONVERSATION_ID}`
    );
  });

  it("omits the origin conversation link when proposal.conversationId is not set", () => {
    const influences: Influence[] = [
      buildInfluence({
        entityId: "conv-host",
        entityType: EntityType.Conversation,
        reasonType: "origin",
      }),
    ];

    renderBlock(buildProposal(influences, { conversationId: undefined }));

    expect(screen.getByTestId("proposal-influence-origin")).toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-influence-origin-link")
    ).not.toBeInTheDocument();
  });

  it("returns null when influences is undefined", () => {
    const { container } = render(
      <MemoryRouter>
        <PathServiceProvider pathService={getPathService()}>
          <ProposalInfluencesBlock
            organizationId={ORG_ID}
            projectId={PROJECT_ID}
            proposal={buildProposal(undefined)}
          />
        </PathServiceProvider>
      </MemoryRouter>
    );

    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByTestId("proposal-influences-block")
    ).not.toBeInTheDocument();
  });

  it("returns null when influences is an empty array", () => {
    const { container } = render(
      <MemoryRouter>
        <PathServiceProvider pathService={getPathService()}>
          <ProposalInfluencesBlock
            organizationId={ORG_ID}
            projectId={PROJECT_ID}
            proposal={buildProposal([])}
          />
        </PathServiceProvider>
      </MemoryRouter>
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders chips for all reason types: explicit_mention, implied, derived, origin", () => {
    const influences: Influence[] = [
      buildInfluence({ entityId: "a", reasonType: "explicit_mention" }),
      buildInfluence({ entityId: "b", reasonType: "implied" }),
      buildInfluence({ entityId: "c", reasonType: "derived" }),
      buildInfluence({
        entityId: "d",
        entityType: EntityType.Conversation,
        reasonType: "origin",
      }),
    ];

    renderBlock(buildProposal(influences));

    expect(
      screen.getByTestId("proposal-influence-chip-explicit_mention")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("proposal-influence-chip-implied")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("proposal-influence-chip-derived")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("proposal-influence-chip-origin")
    ).toBeInTheDocument();
  });

  it("uses an explicit unavailable name without exposing the entity id", () => {
    const influences: Influence[] = [
      buildInfluence({
        entityId: "abcdef1234567890",
        entityTitle: null,
      }),
    ];

    renderBlock(buildProposal(influences));

    const link = screen.getByTestId("entity-link");
    expect(link).toHaveTextContent("Task name unavailable");
    expect(link).not.toHaveTextContent("abcdef1234567890");
  });
});
