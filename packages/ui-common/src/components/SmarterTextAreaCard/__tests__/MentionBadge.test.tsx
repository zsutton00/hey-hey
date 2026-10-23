import React from "react";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  DndContext,
  type DragStartEvent as DndKitDragStartEvent,
} from "@dnd-kit/core";
import { MemoryRouter } from "react-router-dom";
import { MentionBadgeInner, type MentionMode } from "../MentionBadge";
import type { EntityMention } from "../types";
import { MentionEditorContext } from "../EditorContext";
import { navigateToEntity } from "../../../components/WebUtils/navigateToEntity";

vi.mock("../../../components/WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));

vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: () => ({
    data: null,
    isLoading: false,
    error: null,
    fetch: vi.fn(),
  }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({ workItem: undefined }),
}));

vi.mock("../EntityHoverCard", () => ({
  EntityHoverCard: ({ entityId }: { entityId: string }) => (
    <div data-testid="mention-hover-card" data-entity-id={entityId} />
  ),
}));

const mockNavigateToEntity = vi.mocked(navigateToEntity);

function renderBadge(
  mention: EntityMention,
  onDragStart?: (event: DndKitDragStartEvent) => void,
  mode?: MentionMode
) {
  return render(
    <MemoryRouter>
      <DndContext onDragStart={onDragStart}>
        <MentionEditorContext.Provider
          value={{
            organizationId: "org-1",
            projectId: "project-1",
            navigate: vi.fn(),
          }}
        >
          <MentionBadgeInner mention={mention} mode={mode} />
        </MentionEditorContext.Provider>
      </DndContext>
    </MemoryRouter>
  );
}

describe("MentionBadgeInner — drag source", () => {
  const mention: EntityMention = {
    entityId: "task-123",
    entityType: "task",
    entityName: "Build login page",
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("registers the badge as a dnd-kit draggable", () => {
    renderBadge(mention);
    const badge = screen.getByTestId("mention-badge");
    const interaction = screen.getByTestId("interaction-component");
    expect(interaction.getAttribute("role")).toBe("group");
    expect(interaction.tagName).toBe("SPAN");
    expect(interaction).toHaveAttribute("data-id-scope", "mention");
    expect(badge).toHaveAttribute(
      "data-mention-token",
      "@[task:task-123|Build login page]"
    );
    expect(badge).toHaveAttribute("data-entity-id", "task-123");
    expect(badge).toHaveAttribute("data-entity-type", "task");
    expect(badge).toHaveAttribute("data-entity-name", "Build login page");
  });

  it("fires drag start with the entity payload and the mention idScope", () => {
    const onDragStart = vi.fn();
    renderBadge(mention, onDragStart);

    const interaction = screen.getByTestId("interaction-component");
    fireEvent.keyDown(interaction, { code: "Space" });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    const event = onDragStart.mock.calls[0][0] as DndKitDragStartEvent;
    const data = event.active.data.current as {
      content: { type: string; data: Record<string, unknown> };
      sourceId: string;
    };
    expect(data.sourceId).toBe("interaction-task-123-mention");
    expect(data.content).toEqual({
      type: "entity",
      data: {
        entityId: "task-123",
        entityType: "task",
        entityName: "Build login page",
        entitySubtype: undefined,
      },
    });
  });

  it("opens the shared menu with the complete parsed identity", () => {
    renderBadge(mention);

    const interaction = screen.getByTestId("interaction-component");
    fireEvent.contextMenu(interaction, {
      button: 2,
      clientX: 18,
      clientY: 28,
    });

    expect(interaction).toHaveAttribute("data-entity-id", "task-123");
    expect(interaction).toHaveAttribute("data-entity-type", "task");
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-discuss")).toBeInTheDocument();
    expect(screen.getByTestId("interaction-menu-preview")).toBeInTheDocument();
  });

  it("opens the same shared menu on single-button ctrl-click", () => {
    renderBadge(mention);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"), {
      button: 0,
      ctrlKey: true,
      clientX: 18,
      clientY: 28,
    });

    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
  });

  it("always supplies Discuss and Preview before fetched context is available", () => {
    const projectMention: EntityMention = {
      entityId: "project-123",
      entityType: "project",
      entityName: "Platform project",
    };
    renderBadge(projectMention);

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));

    expect(screen.getByTestId("interaction-menu-discuss")).toBeInTheDocument();
    const preview = screen.getByTestId("interaction-menu-preview");
    expect(preview).toBeInTheDocument();

    fireEvent.click(preview);
    expect(screen.getByTestId("mention-hover-card")).toHaveAttribute(
      "data-entity-id",
      projectMention.entityId
    );
  });

  it("closes the hover card when the shared menu opens", () => {
    vi.useFakeTimers();
    renderBadge(mention);

    const badge = screen.getByTestId("mention-badge");
    fireEvent.mouseEnter(badge);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByTestId("mention-hover-card")).toHaveAttribute(
      "data-entity-id",
      mention.entityId
    );

    fireEvent.contextMenu(screen.getByTestId("interaction-component"));
    expect(screen.queryByTestId("mention-hover-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();
  });

  it("retains normal mention navigation", async () => {
    renderBadge(mention);

    fireEvent.click(screen.getByTestId("mention-badge"));
    await waitFor(() => {
      expect(mockNavigateToEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: {
            id: mention.entityId,
            type: mention.entityType,
            name: mention.entityName,
          },
          projectId: "project-1",
        })
      );
    });
  });

  it("preserves Agent Session identity through the mention token, hover, and navigation", async () => {
    const agentSession: EntityMention = {
      entityId: "8c95d89a-6be7-4b99-a3b5-038132f4f7c4",
      entityType: "agent_session",
      entityName: "Review release notes",
    };
    renderBadge(agentSession);

    const badge = screen.getByTestId("mention-badge");
    expect(badge).toHaveAttribute(
      "data-mention-token",
      `@[agent_session:${agentSession.entityId}|${agentSession.entityName}]`
    );
    expect(badge).toHaveAttribute("data-entity-id", agentSession.entityId);

    fireEvent.mouseEnter(badge);
    await waitFor(() =>
      expect(screen.getByTestId("mention-hover-card")).toHaveAttribute(
        "data-entity-id",
        agentSession.entityId
      )
    );
    expect(mockNavigateToEntity).not.toHaveBeenCalled();

    fireEvent.click(badge);
    await waitFor(() =>
      expect(mockNavigateToEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: {
            id: agentSession.entityId,
            type: "agent_session",
            name: agentSession.entityName,
          },
          projectId: "project-1",
        })
      )
    );
  });

  it("preserves proposal identity across the badge interactions", async () => {
    const proposalMention: EntityMention = {
      entityId: "proposal-123",
      entityType: "proposal",
      entityName: "Clarify proposal mentions",
    };
    const onDragStart = vi.fn();
    renderBadge(proposalMention, onDragStart);

    const badge = screen.getByTestId("mention-badge");
    const interaction = screen.getByTestId("interaction-component");
    expect(badge).toHaveTextContent(proposalMention.entityName);
    expect(badge).toHaveAttribute(
      "data-mention-token",
      "@[proposal:proposal-123|Clarify proposal mentions]"
    );
    expect(badge).toHaveAttribute("data-entity-id", proposalMention.entityId);
    expect(badge).toHaveAttribute("data-entity-type", "proposal");

    fireEvent.keyDown(interaction, { code: "Space" });
    const dragEvent = onDragStart.mock.calls[0][0] as DndKitDragStartEvent;
    expect(dragEvent.active.data.current?.content).toEqual({
      type: "entity",
      data: {
        entityId: proposalMention.entityId,
        entityType: proposalMention.entityType,
        entityName: proposalMention.entityName,
        entitySubtype: undefined,
      },
    });

    fireEvent.contextMenu(interaction);
    expect(interaction).toHaveAttribute(
      "data-entity-id",
      proposalMention.entityId
    );
    expect(interaction).toHaveAttribute("data-entity-type", "proposal");
    expect(screen.getByTestId("interaction-context-menu")).toBeInTheDocument();

    fireEvent.click(badge);
    await waitFor(() => {
      expect(mockNavigateToEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: {
            id: proposalMention.entityId,
            type: proposalMention.entityType,
            name: proposalMention.entityName,
          },
        })
      );
    });
  });

  it("links minimal proposal mentions to the canonical proposal page", () => {
    const proposalMention: EntityMention = {
      entityId: "proposal-123",
      entityType: "proposal",
      entityName: "Clarify proposal mentions",
    };
    renderBadge(proposalMention, undefined, "minimal");

    expect(screen.getByTestId("mention-badge")).toHaveAttribute(
      "href",
      "/projects/project-1/proposals/proposal-123"
    );
  });

  it("opens full proposal mentions in a new tab on modified click", async () => {
    const proposalMention: EntityMention = {
      entityId: "proposal-123",
      entityType: "proposal",
      entityName: "Clarify proposal mentions",
    };
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderBadge(proposalMention);

    fireEvent.click(screen.getByTestId("mention-badge"), { metaKey: true });

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "/projects/project-1/proposals/proposal-123",
        "_blank"
      );
    });
  });
});
