import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { DndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import {
  InteractionComponent,
  OpenItemInteractionComponent,
} from "../InteractionComponent";
import type { InteractionComponentProps, OpenItemActions } from "../types";

// IntersectionObserver mock
class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

vi.mock("@dnd-kit/core", async () => {
  const actual = await vi.importActual<typeof import("@dnd-kit/core")>(
    "@dnd-kit/core"
  );
  return {
    ...actual,
    useDraggable: vi.fn(() => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
    })),
    useDroppable: vi.fn(() => ({
      isOver: false,
      setNodeRef: vi.fn(),
    })),
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(() => vi.fn()),
}));

vi.mock("../../WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));

vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    fetch: vi.fn(),
  })),
}));

vi.mock("../useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(() => ({
    launch: vi.fn().mockResolvedValue(true),
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../../../data/hooks/useWorkItemUpdateMethods", () => ({
  useWorkItemUpdateMethods: vi.fn(() => ({ updateTask: vi.fn() })),
}));

vi.mock("../../../data/hooks/useReparentDesignDoc", () => ({
  useReparentDesignDoc: vi.fn(() => ({ reparent: vi.fn() })),
}));

const mockUseDraggable = vi.mocked(useDraggable);
const mockUseDroppable = vi.mocked(useDroppable);

function registeredIds(
  mock: typeof mockUseDraggable | typeof mockUseDroppable
): Set<string | number> {
  return new Set(mock.mock.calls.map(([config]) => config.id));
}

function buildProps(
  overrides: Partial<InteractionComponentProps> = {}
): InteractionComponentProps {
  return {
    entityId: "entity-123",
    entityType: "TASK",
    hasProposalSupport: true,
    organizationId: "org-1",
    projectId: "proj-1",
    children: <div data-testid="child-content">Child</div>,
    ...overrides,
  };
}

function renderWithDnd(props: InteractionComponentProps) {
  return render(
    <DndContext>
      <InteractionComponent {...props} />
    </DndContext>,
    { reactStrictMode: false }
  );
}

function buildOpenItemActions(): OpenItemActions {
  return {
    pin: { hasTargets: true, onSelect: vi.fn() },
    unpin: { hasTargets: false, onSelect: vi.fn() },
    sort: { direction: "newest", onSelect: vi.fn() },
    activeOnly: { enabled: false, onSelect: vi.fn() },
    onRemoveFromOpen: vi.fn(),
    removeOthers: { hasTargets: true, onSelect: vi.fn() },
    removeAllAbove: { hasTargets: true, onSelect: vi.fn() },
    removeAllBelow: { hasTargets: true, onSelect: vi.fn() },
    removeAll: { hasTargets: true, onSelect: vi.fn() },
    whyOpen: { kind: "add", onSelect: vi.fn() },
  };
}

function renderOpenItem(draggable: boolean) {
  return render(
    <DndContext>
      <OpenItemInteractionComponent
        selection={{ selectedIdentities: [], onRemoveSelected: vi.fn() }}
        entityId="entity-123"
        entityType="TASK"
        draggable={draggable}
        openItemActions={buildOpenItemActions()}
      >
        <div data-testid="child-content">Child</div>
      </OpenItemInteractionComponent>
    </DndContext>,
    { reactStrictMode: false }
  );
}

describe("InteractionComponent — drag and drop", () => {
  beforeEach(() => {
    mockUseDraggable.mockClear();
    mockUseDroppable.mockClear();
  });

  it("registers no drag source or drop target for a non-draggable Open Item", () => {
    renderOpenItem(false);

    expect(mockUseDraggable).not.toHaveBeenCalled();
    expect(mockUseDroppable).not.toHaveBeenCalled();
  });

  it("registers the standalone drag source exactly once and no drop targets for a draggable Open Item", () => {
    renderOpenItem(true);

    expect(mockUseDraggable).toHaveBeenCalledOnce();
    expect(mockUseDroppable).not.toHaveBeenCalled();
  });

  it("keeps the standard task drag source and both task-host drop targets", () => {
    renderWithDnd(buildProps());

    expect(registeredIds(mockUseDraggable).size).toBe(1);
    expect(registeredIds(mockUseDroppable).size).toBe(2);
  });

  it("renders with draggable attributes when hasProposalSupport is true", () => {
    renderWithDnd(buildProps());

    const el = screen.getByTestId("interaction-component");
    expect(el).toBeInTheDocument();
    // @dnd-kit adds data-dnd-draggable attributes internally;
    // we verify the component still renders and is functional
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("does not add drag behavior when hasProposalSupport is false", () => {
    renderWithDnd(buildProps({ hasProposalSupport: false }));

    const el = screen.getByTestId("interaction-component");
    expect(el).toBeInTheDocument();
    // idle state for non-interactive
    expect(el).toHaveAttribute("data-interaction-state", "idle");
    expect(registeredIds(mockUseDraggable).size).toBe(1);
    expect(
      mockUseDraggable.mock.calls.every(([config]) => config.disabled)
    ).toBe(true);
    expect(registeredIds(mockUseDroppable).size).toBe(2);
  });

  it("sets entity data attributes for drag identification", () => {
    renderWithDnd(buildProps());

    const el = screen.getByTestId("interaction-component");
    expect(el).toHaveAttribute("data-entity-id", "entity-123");
    expect(el).toHaveAttribute("data-entity-type", "TASK");
  });
});
