import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { CliReadProjectSessionCostRow } from "../../../../api";
import { CostsActivityRow } from "../CostsActivityRow";

const baseRow: CliReadProjectSessionCostRow = {
  agentSessionId: "11111111-1111-4111-8111-111111111111",
  conversationId: "22222222-2222-4222-8222-222222222222",
  context: {
    entityType: "TASK",
    entityId: "33333333-3333-4333-8333-333333333333",
    entityTitle: "Implement Costs",
    promptType: "coding",
  },
  providerSessions: [],
  knownCostUsd: 4.25,
  completeness: "complete",
  latestActivityAt: "2026-07-28T11:30:00.000Z",
  costReadAt: "2026-07-28T12:00:00.000Z",
};

describe("CostsActivityRow", () => {
  it("links a conversation-backed session title through the resolver", () => {
    render(
      <MemoryRouter>
        <CostsActivityRow projectId="project-1" row={baseRow} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("link", { name: "Implement Costs" })
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session/22222222-2222-4222-8222-222222222222"
    );
  });

  it("renders a plain title when the collection has no conversation identity", () => {
    render(
      <MemoryRouter>
        <CostsActivityRow
          projectId="project-1"
          row={{ ...baseRow, conversationId: null }}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Implement Costs")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Implement Costs" })).toBeNull();
  });
});
