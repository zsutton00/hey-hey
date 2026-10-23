import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DndContext as CoreDndContext } from "@dnd-kit/core";
import { DesignDocParentEntityType, TargetEntityType } from "../../../api";
import { InteractionComponent } from "../InteractionComponent";
import type { InteractionComponentProps } from "../types";

// IntersectionObserver mock so the indicator-corner hook resolves.
class MockIntersectionObserver {
  private callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

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

// Capture droppable registrations so the test can fire the onDrop callback.
type DroppableRegistration = {
  id: string;
  disabled?: boolean;
  data?: { onDrop?: (event: unknown) => void };
};
const droppableRegistrations: DroppableRegistration[] = [];

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    useDroppable: (config: DroppableRegistration) => {
      droppableRegistrations.push(config);
      return {
        setNodeRef: () => {},
        isOver: false,
        active: null,
        over: null,
        node: { current: null },
        rect: { current: null },
      };
    },
  };
});

const mockReparent = vi.fn();
vi.mock("../../../data/hooks/useReparentDesignDoc", () => ({
  useReparentDesignDoc: vi.fn(() => ({
    reparent: mockReparent,
  })),
}));

// useDndContextSafe — test seeds an active design-doc drag.
const mockDndState = {
  activeContent: {
    type: "entity" as const,
    data: {
      entityId: "doc-source",
      entityType: TargetEntityType.DesignDoc,
      entityName: "Source Doc",
    },
  },
  activeSourceId: "interaction-doc-source",
  isDragging: true,
  setActiveContent: vi.fn(),
  setActiveSourceId: vi.fn(),
  setIsDragging: vi.fn(),
};
vi.mock("../../../contexts/DndContext", () => ({
  useDndContextSafe: () => mockDndState,
  DndProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function buildProps(
  overrides: Partial<InteractionComponentProps> = {},
): InteractionComponentProps {
  return {
    entityId: "target-task",
    entityType: TargetEntityType.Task,
    hasProposalSupport: true,
    organizationId: "org-1",
    projectId: "proj-1",
    children: <div data-testid="child-content">child</div>,
    ...overrides,
  };
}

function renderTarget(props: InteractionComponentProps) {
  return render(
    <CoreDndContext>
      <InteractionComponent {...props} />
    </CoreDndContext>,
  );
}

beforeEach(() => {
  droppableRegistrations.length = 0;
  mockReparent.mockReset();
  mockReparent.mockResolvedValue(undefined);
});

function findDesignDocDroppable(entityId: string) {
  return droppableRegistrations.find(
    (reg) =>
      reg.id === `interaction-designdoc-drop-${entityId}` ||
      reg.id.startsWith(`interaction-designdoc-drop-${entityId}-`),
  );
}

describe("InteractionComponent — design-doc drop target", () => {
  it("moves every design doc in a batch and rejects mixed batches without partial mutation", async () => {
    renderTarget(buildProps({ entityId: "target-task" }));
    await waitFor(() => expect(findDesignDocDroppable("target-task")).toBeDefined());
    const target = findDesignDocDroppable("target-task");
    const first = { entityId: "first", entityType: TargetEntityType.DesignDoc, entityName: "First" };
    const second = { entityId: "second", entityType: TargetEntityType.DesignDoc, entityName: "Second" };
    target?.data?.onDrop?.({ content: { type: "entities", data: [first, second] } });
    expect(mockReparent).toHaveBeenCalledTimes(2);
    expect(mockReparent.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
    mockReparent.mockClear();
    target?.data?.onDrop?.({ content: { type: "entities", data: [
      first, { ...second, entityType: TargetEntityType.Task },
    ] } });
    expect(mockReparent).not.toHaveBeenCalled();
  });

  it("registers a design-doc droppable for Task entities", async () => {
    renderTarget(buildProps({ entityId: "target-task" }));

    await waitFor(() => {
      expect(findDesignDocDroppable("target-task")).toBeDefined();
    });
    expect(screen.getByTestId("child-content")).toBeInTheDocument();
  });

  it("registers a design-doc droppable for DesignDoc entities", async () => {
    renderTarget(
      buildProps({
        entityId: "target-doc",
        entityType: TargetEntityType.DesignDoc,
      }),
    );

    await waitFor(() => {
      expect(findDesignDocDroppable("target-doc")).toBeDefined();
    });
  });

  it("does not register a design-doc droppable for unrelated entity types", async () => {
    renderTarget(
      buildProps({
        entityId: "target-service",
        entityType: TargetEntityType.Service,
      }),
    );

    expect(findDesignDocDroppable("target-service")).toBeUndefined();
  });

  it("dispatches reparent with parentEntityType=TASK on drop onto a Task", async () => {
    renderTarget(buildProps({ entityId: "target-task" }));

    await waitFor(() => {
      expect(findDesignDocDroppable("target-task")).toBeDefined();
    });

    const droppable = findDesignDocDroppable("target-task");
    droppable?.data?.onDrop?.({
      content: {
        type: "entity",
        data: {
          entityId: "doc-source",
          entityType: TargetEntityType.DesignDoc,
          entityName: "Source Doc",
        },
      },
      sourceId: "src",
      targetId: "target-task",
    });

    expect(mockReparent).toHaveBeenCalledWith(
      "doc-source",
      "target-task",
      DesignDocParentEntityType.Task,
    );
  });

  it("dispatches reparent with parentEntityType=DESIGN_DOC on drop onto a DesignDoc", async () => {
    renderTarget(
      buildProps({
        entityId: "target-doc",
        entityType: TargetEntityType.DesignDoc,
      }),
    );

    await waitFor(() => {
      expect(findDesignDocDroppable("target-doc")).toBeDefined();
    });

    const droppable = findDesignDocDroppable("target-doc");
    droppable?.data?.onDrop?.({
      content: {
        type: "entity",
        data: {
          entityId: "doc-source",
          entityType: TargetEntityType.DesignDoc,
          entityName: "Source Doc",
        },
      },
      sourceId: "src",
      targetId: "target-doc",
    });

    expect(mockReparent).toHaveBeenCalledWith(
      "doc-source",
      "target-doc",
      DesignDocParentEntityType.DesignDoc,
    );
  });

  it("disables the droppable when the dragged doc equals the target entity (self-drop)", async () => {
    renderTarget(
      buildProps({
        entityId: "doc-source",
        entityType: TargetEntityType.DesignDoc,
      }),
    );

    await waitFor(() => {
      expect(findDesignDocDroppable("doc-source")).toBeDefined();
    });
    const droppable = findDesignDocDroppable("doc-source");
    expect(droppable?.disabled).toBe(true);
  });

  it("ignores drops whose payload is not a design-doc entity", async () => {
    renderTarget(buildProps({ entityId: "target-task" }));

    await waitFor(() => {
      expect(findDesignDocDroppable("target-task")).toBeDefined();
    });
    const droppable = findDesignDocDroppable("target-task");
    droppable?.data?.onDrop?.({
      content: {
        type: "entity",
        data: {
          entityId: "task-source",
          entityType: TargetEntityType.Task,
          entityName: "Source Task",
        },
      },
      sourceId: "src",
      targetId: "target-task",
    });

    expect(mockReparent).not.toHaveBeenCalled();
  });
});
