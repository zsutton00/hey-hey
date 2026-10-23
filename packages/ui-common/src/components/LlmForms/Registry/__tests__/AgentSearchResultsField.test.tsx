import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { FieldComponentContext, FieldConfig } from "../types";
import { AgentSearchResultsField } from "../AgentSearchResultsField";

vi.mock("../../../../contexts/ModalService", () => ({
  useModalService: () => null,
}));

const context: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "organization-1",
};

const config = {
  field: "search-results",
  description: "Search results",
  type: "agent_search_results",
  payload: [
    {
      entityType: "MESSAGE",
      entityId: "message-1",
      title: "",
      reason: "A titleless message result",
    },
    {
      entityType: "TASK",
      entityId: "task-1",
      title: "Implement search",
    },
  ],
} as unknown as FieldConfig;

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};

describe("AgentSearchResultsField", () => {
  it("renders titleless message results with a stable label", () => {
    render(
      <MemoryRouter>
        <AgentSearchResultsField
          config={config}
          context={context}
          isSubmitted
        />
      </MemoryRouter>
    );

    expect(screen.getByTestId("agent-search-results-field")).toBeInTheDocument();
    expect(screen.getByText("Untitled message")).toBeInTheDocument();
    expect(screen.getByText("Implement search")).toBeInTheDocument();
    expect(screen.queryByText(/responseType/)).not.toBeInTheDocument();
  });

  it("navigates titleless message results through message resolution", async () => {
    render(
      <MemoryRouter>
        <AgentSearchResultsField
          config={config}
          context={context}
          isSubmitted
        />
        <LocationProbe />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByTestId("agent-search-results-result")[0]!);

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/projects/project-1/resolve-message/message-1"
      )
    );
  });
});
