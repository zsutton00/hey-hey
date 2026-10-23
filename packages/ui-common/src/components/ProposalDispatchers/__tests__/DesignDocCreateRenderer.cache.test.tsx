import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type CreateDesignDocDto,
  type ProposalResponseDto,
} from "../../../api";
import { DesignDocCreateRenderer } from "../DesignDocCreateRenderer";
import { __resetForTests, setNewEntityId } from "../proposalSelectedStateCache";
import { PLACEHOLDER_ENTITY_ID } from "../types";

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    getProposal: vi.fn(),
  },
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

afterEach(() => {
  cleanup();
  __resetForTests();
});

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const PROPOSAL_ID = "prop-cache-1";
const RESOLVED_ID = "doc-real-42";

function makePlaceholderProposal(): ProposalResponseDto & {
  updates: CreateDesignDocDto;
} {
  return {
    id: PROPOSAL_ID,
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Approved,
    targetEntityId: PLACEHOLDER_ENTITY_ID,
    targetEntityType: TargetEntityType.DesignDoc,
    updates: {
      name: "Cached Doc",
      sections: [{ key: "context", order: 1, content: "Context body" }],
    },
    requestorId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as ProposalResponseDto & { updates: CreateDesignDocDto };
}

describe("DesignDocCreateRenderer — newEntityId cache seeding", () => {
  it("renders the resolved-entity link on first mount when the cache holds the resolved id", () => {
    setNewEntityId(PROPOSAL_ID, RESOLVED_ID);

    render(
      <MemoryRouter>
        <DesignDocCreateRenderer
          proposal={makePlaceholderProposal()}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const link = screen.getByRole("link", { name: "Cached Doc" });
    expect(link.getAttribute("href")).toContain(RESOLVED_ID);
    expect(link.getAttribute("href")).not.toContain(PLACEHOLDER_ENTITY_ID);
  });

  it("falls back to the placeholder render path when no cache entry exists", () => {
    render(
      <MemoryRouter>
        <DesignDocCreateRenderer
          proposal={makePlaceholderProposal()}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    expect(screen.queryByRole("link", { name: "Cached Doc" })).toBeNull();
    expect(screen.getByText("Cached Doc")).toBeInTheDocument();
  });
});
