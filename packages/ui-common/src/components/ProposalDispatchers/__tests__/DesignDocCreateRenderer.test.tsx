import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type CreateDesignDocDto,
  type ProposalResponseDto,
} from "../../../api";
import { DesignDocCreateRenderer } from "../DesignDocCreateRenderer";

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

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const TARGET_ID = "doc-target-1";

function makeProposal(
  updates: CreateDesignDocDto
): ProposalResponseDto & { updates: CreateDesignDocDto } {
  return {
    id: "proposal-1",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Pending,
    targetEntityId: TARGET_ID,
    targetEntityType: TargetEntityType.DesignDoc,
    updates,
    requestorId: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as ProposalResponseDto & { updates: CreateDesignDocDto };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DesignDocCreateRenderer", () => {
  it("renders name and summary", () => {
    const proposal = makeProposal({
      name: "My New Doc",
      summary: "Short summary",
      sections: [],
    });

    render(
      <MemoryRouter>
        <DesignDocCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("My New Doc")).toBeInTheDocument();
    expect(screen.getByText("Short summary")).toBeInTheDocument();
  });

  it("passes each section's content to MarkdownRenderer in section-order", () => {
    const proposal = makeProposal({
      name: "Doc with sections",
      sections: [
        { key: "decision", order: 2, content: "Decision body" },
        { key: "context", order: 1, content: "Context body" },
        { key: "consequences", order: 3, content: "Consequences body" },
      ],
    });

    render(
      <MemoryRouter>
        <DesignDocCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const rendered = screen
      .getAllByTestId("markdown")
      .map((el) => el.textContent);
    expect(rendered).toEqual([
      "Context body",
      "Decision body",
      "Consequences body",
    ]);

    expect(screen.getByText("context")).toBeInTheDocument();
    expect(screen.getByText("decision")).toBeInTheDocument();
    expect(screen.getByText("consequences")).toBeInTheDocument();
  });

  it("does not crash and shows no body block when there are zero sections", () => {
    const proposal = makeProposal({
      name: "Empty Doc",
      sections: [],
    });

    render(
      <MemoryRouter>
        <DesignDocCreateRenderer
          proposal={proposal}
          status={{ state: "pending" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Empty Doc")).toBeInTheDocument();
    expect(screen.queryAllByTestId("markdown")).toHaveLength(0);
  });

  it("renders state indicator and target link when applied", () => {
    const proposal = makeProposal({
      name: "Applied Doc",
      sections: [{ key: "context", order: 1, content: "Context body" }],
    });

    render(
      <MemoryRouter>
        <DesignDocCreateRenderer
          proposal={proposal}
          status={{ state: "applied" }}
          onApply={() => {}}
        />
      </MemoryRouter>
    );

    const titleLink = screen.getByRole("link", { name: "Applied Doc" });
    expect(titleLink).toBeInTheDocument();
    expect(titleLink.getAttribute("href")).toContain(TARGET_ID);
    expect(screen.getByText("Created")).toBeInTheDocument();
  });
});
