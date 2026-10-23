import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ScratchpadPage } from "../ScratchpadPage";
import { useScratchpad } from "../useScratchpad";
import type { ScratchpadItem } from "../types";
import { ProjectContext } from "../../../contexts/ProjectContext";
import { getPathService } from "../../../services/webPathService";

vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: vi.fn(() => ({
    currentOrgId: "org-1",
    name: "Test User",
    email: "test@example.com",
  })),
}));

const mockItems: ScratchpadItem[] = [
  {
    entityId: "task-1",
    entityType: "TASK",
    entityName: "First Task",
    sourceContentType: "entity",
    addedAt: 1000,
  },
  {
    entityId: "task-2",
    entityType: "TASK",
    entityName: "Second Task",
    sourceContentType: "entity",
    addedAt: 2000,
  },
];

const mockRemoveItem = vi.fn();
const mockClearAll = vi.fn();

vi.mock("../useScratchpad", () => ({
  useScratchpad: vi.fn(() => ({
    items: mockItems,
    addFromDrag: vi.fn(),
    removeItem: mockRemoveItem,
    reorderItems: vi.fn(),
    clearAll: mockClearAll,
  })),
}));

const PROJECT_ID = "project-1";

const LocationDisplay: React.FC = () => {
  const location = useLocation();
  return <span data-testid="location-path">{location.pathname}</span>;
};

const renderWithProviders = () =>
  render(
    <MemoryRouter>
      <ProjectContext.Provider
        value={{
          organizationId: "org-1",
          projectId: PROJECT_ID,
          navigate: vi.fn(),
        }}
      >
        <ScratchpadPage />
      </ProjectContext.Provider>
    </MemoryRouter>
  );

describe("ScratchpadPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders items with names and types", () => {
    renderWithProviders();

    expect(screen.getByText("First Task")).toBeInTheDocument();
    expect(screen.getByText("Second Task")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("calls removeItem when delete button is clicked", () => {
    renderWithProviders();

    const removeButtons = screen.getAllByLabelText("Remove from scratchpad");
    fireEvent.click(removeButtons[0]);

    expect(mockRemoveItem).toHaveBeenCalledWith("task-1");
  });

  it("calls clearAll when clear button is clicked", () => {
    renderWithProviders();

    fireEvent.click(screen.getByText("Clear all"));
    expect(mockClearAll).toHaveBeenCalled();
  });

  it("wraps each row in an anchor pointing at the entity's canonical route", () => {
    renderWithProviders();

    const pathService = getPathService();
    const expectedHrefs = mockItems.map((item) =>
      pathService.task({ projectId: PROJECT_ID, taskId: item.entityId })
    );

    const anchors = screen
      .getAllByRole("link")
      .filter((el) => expectedHrefs.includes(el.getAttribute("href") ?? ""));

    expect(anchors).toHaveLength(mockItems.length);
    expectedHrefs.forEach((href, i) => {
      expect(anchors[i]).toHaveAttribute("href", href);
      expect(anchors[i]).toHaveTextContent(mockItems[i].entityName);
    });
  });

  it("keeps the remove button outside the anchor", () => {
    renderWithProviders();

    const removeButtons = screen.getAllByLabelText("Remove from scratchpad");
    removeButtons.forEach((button) => {
      expect(button.closest("a")).toBeNull();
    });
  });

  it("does not open a new window on a plain click (routes via RouterLink)", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderWithProviders();

    const firstAnchor = screen
      .getAllByRole("link")
      .find((el) =>
        el
          .getAttribute("href")
          ?.endsWith(`/projects/${PROJECT_ID}/tasks/task-1`)
      );
    expect(firstAnchor).toBeDefined();

    fireEvent.click(firstAnchor!, { button: 0 });

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("does not prevent default on cmd/ctrl-click so the browser can open a new tab", () => {
    renderWithProviders();

    const firstAnchor = screen
      .getAllByRole("link")
      .find((el) =>
        el
          .getAttribute("href")
          ?.endsWith(`/projects/${PROJECT_ID}/tasks/task-1`)
      );
    expect(firstAnchor).toBeDefined();

    const cmdClickEvent = fireEvent.click(firstAnchor!, {
      button: 0,
      metaKey: true,
    });

    // Browser default (open in new tab) must remain available — RouterLink
    // should bail out of navigation on modifier keys without preventDefault.
    expect(cmdClickEvent).toBe(true);
  });

  it("renders and navigates to an Agent Session without changing its identity", () => {
    const agentSessionId = "57023a5c-29a1-4df2-b4f9-45d2684fd5d8";
    const agentSessionName = "Review release notes";
    vi.mocked(useScratchpad).mockReturnValueOnce({
      items: [
        {
          entityId: agentSessionId,
          entityType: "AGENT_SESSION",
          entityName: agentSessionName,
          sourceContentType: "entity",
          addedAt: 3000,
        },
      ],
      addFromDrag: vi.fn(),
      removeItem: mockRemoveItem,
      reorderItems: vi.fn(),
      clearAll: mockClearAll,
    });

    render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/scratchpad`]}>
        <ProjectContext.Provider
          value={{
            organizationId: "org-1",
            projectId: PROJECT_ID,
            navigate: vi.fn(),
          }}
        >
          <ScratchpadPage />
          <LocationDisplay />
        </ProjectContext.Provider>
      </MemoryRouter>
    );

    const agentSessionLink = screen.getByRole("link", {
      name: new RegExp(agentSessionName),
    });
    const agentSessionPath = getPathService().agentSession({
      projectId: PROJECT_ID,
      agentSessionId,
    });

    expect(agentSessionLink).toHaveAttribute("href", agentSessionPath);
    expect(agentSessionLink).toHaveTextContent("Agent session");

    fireEvent.click(agentSessionLink);

    expect(screen.getByTestId("location-path")).toHaveTextContent(
      agentSessionPath
    );
  });
});
