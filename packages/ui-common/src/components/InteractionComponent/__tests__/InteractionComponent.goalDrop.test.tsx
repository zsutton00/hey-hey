import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DndContext as CoreDndContext } from "@dnd-kit/core";
import { EntityType, TargetEntityType } from "../../../api";
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

// Capture droppable registrations so the test can fire onDrop directly.
type DroppableRegistration = {
  id: string;
  disabled?: boolean;
  data?: { onDrop?: (event: unknown) => void };
};
const droppableRegistrations: DroppableRegistration[] = [];
const activeDroppableIds = new Map<string, string>();

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    useDroppable: (config: DroppableRegistration) => {
      const registrationKey = React.useId();
      React.useEffect(() => {
        activeDroppableIds.set(config.id, registrationKey);
        return () => {
          if (activeDroppableIds.get(config.id) === registrationKey) {
            activeDroppableIds.delete(config.id);
          }
        };
      }, [config.id, registrationKey]);
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

const mockAttach = vi.fn();
vi.mock("../../../data/hooks/useAttachToGoal", () => ({
  useAttachToGoal: vi.fn(() => ({
    attach: mockAttach,
    isLoading: false,
    error: null,
  })),
}));

// useReparentDesignDoc is still imported by InteractionComponent because the
// design-doc drop target mounts on Task hosts (goals are Task entities).
const mockReparent = vi.fn();
vi.mock("../../../data/hooks/useReparentDesignDoc", () => ({
  useReparentDesignDoc: vi.fn(() => ({
    reparent: mockReparent,
  })),
}));

// useWorkItemUpdateMethods is needed for the TaskDropTarget on non-goal hosts.
const mockUpdateTask = vi.fn();
vi.mock("../../../data/hooks/useWorkItemUpdateMethods", () => ({
  useWorkItemUpdateMethods: vi.fn(() => ({
    updateTask: mockUpdateTask,
  })),
}));

// useDndContextSafe — the test mutates this between cases to seed the active
// drag content.
type ActiveDrag = import("../../../types/dragAndDrop").DraggableContent | null;

const mockDndState: {
  activeContent: ActiveDrag;
  activeSourceId: string | null;
  isDragging: boolean;
  setActiveContent: ReturnType<typeof vi.fn>;
  setActiveSourceId: ReturnType<typeof vi.fn>;
  setIsDragging: ReturnType<typeof vi.fn>;
} = {
  activeContent: null,
  activeSourceId: null,
  isDragging: false,
  setActiveContent: vi.fn(),
  setActiveSourceId: vi.fn(),
  setIsDragging: vi.fn(),
};

vi.mock("../../../contexts/DndContext", () => ({
  useDndContextSafe: () => mockDndState,
  DndProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const GOAL_HOST_ID = "goal-host";
const NON_GOAL_TASK_HOST_ID = "task-host";

function buildGoalHostProps(
  overrides: Partial<InteractionComponentProps> = {},
): InteractionComponentProps {
  return {
    entityId: GOAL_HOST_ID,
    entityType: TargetEntityType.Task,
    entitySubtype: "GOAL",
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

function findGoalDroppable(entityId: string) {
  return droppableRegistrations.find(
    (reg) =>
      reg.id === `interaction-goal-drop-${entityId}` ||
      reg.id.startsWith(`interaction-goal-drop-${entityId}-`),
  );
}

function findTaskDroppable(entityId: string) {
  return droppableRegistrations.find(
    (reg) =>
      reg.id === `interaction-drop-${entityId}` ||
      reg.id.startsWith(`interaction-drop-${entityId}-`),
  );
}

function setActiveDrag(content: ActiveDrag) {
  mockDndState.activeContent = content;
  mockDndState.isDragging = content !== null;
  mockDndState.activeSourceId = content
    ? `interaction-${content.data.entityId}`
    : null;
}

beforeEach(() => {
  droppableRegistrations.length = 0;
  activeDroppableIds.clear();
  mockAttach.mockReset();
  mockAttach.mockResolvedValue({ edge: {}, target: {}, created: true });
  mockReparent.mockReset();
  mockReparent.mockResolvedValue(undefined);
  mockUpdateTask.mockReset();
  setActiveDrag(null);
});

describe("InteractionComponent — goal drop target", () => {
  it("reparents every task in a batch and rejects a batch containing the destination", async () => {
    const first = { entityId: "first", entityType: TargetEntityType.Task, entityName: "First" };
    const second = { entityId: "second", entityType: TargetEntityType.Task, entityName: "Second" };
    setActiveDrag({ type: "entities", data: [first, second] });
    renderTarget(buildGoalHostProps({ entityId: NON_GOAL_TASK_HOST_ID, entitySubtype: "STANDARD" }));
    await waitFor(() => expect(findTaskDroppable(NON_GOAL_TASK_HOST_ID)).toBeDefined());
    const target = findTaskDroppable(NON_GOAL_TASK_HOST_ID);
    expect(target?.disabled).toBe(false);
    target?.data?.onDrop?.({ content: { type: "entities", data: [first, second] } });
    expect(mockUpdateTask).toHaveBeenCalledWith("first", { parentTaskId: NON_GOAL_TASK_HOST_ID });
    expect(mockUpdateTask).toHaveBeenCalledWith("second", { parentTaskId: NON_GOAL_TASK_HOST_ID });
    mockUpdateTask.mockClear();
    target?.data?.onDrop?.({ content: { type: "entities", data: [
      first, { ...second, entityId: NON_GOAL_TASK_HOST_ID },
    ] } });
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it("accepts every compatible batch member and rejects a mixed batch completely", async () => {
    const data = [
      { entityId: "first", entityType: TargetEntityType.Task, entityName: "First" },
      { entityId: "second", entityType: TargetEntityType.Task, entityName: "Second" },
    ];
    setActiveDrag({ type: "entities", data: [data[0], data[1]] });
    renderTarget(buildGoalHostProps());
    await waitFor(() => expect(findGoalDroppable(GOAL_HOST_ID)).toBeDefined());
    const target = findGoalDroppable(GOAL_HOST_ID);
    expect(target?.disabled).toBe(false);
    target?.data?.onDrop?.({ content: { type: "entities", data } });
    expect(mockAttach).toHaveBeenCalledTimes(2);
    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ targetEntityId: "first" }));
    expect(mockAttach).toHaveBeenCalledWith(expect.objectContaining({ targetEntityId: "second" }));
    mockAttach.mockClear();
    target?.data?.onDrop?.({ content: { type: "entities", data: [
      data[0], { entityId: "doc", entityType: TargetEntityType.DesignDoc, entityName: "Doc" },
    ] } });
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it("keeps the original goal target registered when a duplicate mounted instance unmounts", async () => {
    const renderDuplicateTargets = (showDetailTarget: boolean) => (
      <CoreDndContext>
        <InteractionComponent {...buildGoalHostProps()} />
        {showDetailTarget && <InteractionComponent {...buildGoalHostProps()} />}
      </CoreDndContext>
    );
    const { rerender } = render(renderDuplicateTargets(true));
    const goalDropIdPrefix = `interaction-goal-drop-${GOAL_HOST_ID}-`;

    await waitFor(() => {
      expect(
        [...activeDroppableIds.keys()].filter((id) =>
          id.startsWith(goalDropIdPrefix),
        ),
      ).toHaveLength(2);
    });

    const [originalGoalDropId, detailGoalDropId] = [
      ...activeDroppableIds.keys(),
    ].filter((id) => id.startsWith(goalDropIdPrefix));
    expect(originalGoalDropId).not.toBe(detailGoalDropId);

    rerender(renderDuplicateTargets(false));

    await waitFor(() => {
      expect(
        [...activeDroppableIds.keys()].filter((id) =>
          id.startsWith(goalDropIdPrefix),
        ),
      ).toEqual([originalGoalDropId]);
    });
  });

  it("attaches a non-goal Task drag onto a goal host with the goal as parent", async () => {
    setActiveDrag({
      type: "entity",
      data: {
        entityId: "task-source",
        entityType: TargetEntityType.Task,
        entityName: "Source Task",
        entitySubtype: "STANDARD",
      },
    });

    renderTarget(buildGoalHostProps());

    await waitFor(() => {
      expect(findGoalDroppable(GOAL_HOST_ID)).toBeDefined();
    });
    const droppable = findGoalDroppable(GOAL_HOST_ID);
    expect(droppable?.disabled).toBe(false);

    droppable?.data?.onDrop?.({
      content: {
        type: "entity",
        data: {
          entityId: "task-source",
          entityType: TargetEntityType.Task,
          entityName: "Source Task",
          entitySubtype: "STANDARD",
        },
      },
      sourceId: "src",
      targetId: GOAL_HOST_ID,
    });

    expect(mockAttach).toHaveBeenCalledWith({
      goalId: GOAL_HOST_ID,
      targetEntityId: "task-source",
      targetEntityType: EntityType.Task,
    });
  });

  it("attaches a Plan drag onto a goal host with targetEntityType=TASK", async () => {
    setActiveDrag({
      type: "entity",
      data: {
        entityId: "plan-source",
        entityType: TargetEntityType.Task,
        entitySubtype: "PLAN",
        entityName: "Source Plan",
      },
    });

    renderTarget(buildGoalHostProps());

    await waitFor(() => {
      expect(findGoalDroppable(GOAL_HOST_ID)).toBeDefined();
    });
    const droppable = findGoalDroppable(GOAL_HOST_ID);
    expect(droppable?.disabled).toBe(false);

    droppable?.data?.onDrop?.({
      content: {
        type: "entity",
        data: {
          entityId: "plan-source",
          entityType: TargetEntityType.Task,
          entitySubtype: "PLAN",
          entityName: "Source Plan",
        },
      },
      sourceId: "src",
      targetId: GOAL_HOST_ID,
    });

    expect(mockAttach).toHaveBeenCalledWith({
      goalId: GOAL_HOST_ID,
      targetEntityId: "plan-source",
      targetEntityType: EntityType.Task,
    });
  });

  it("does not attach when a DesignDoc is dragged onto a goal host and keeps the overlay disabled", async () => {
    setActiveDrag({
      type: "entity",
      data: {
        entityId: "doc-source",
        entityType: TargetEntityType.DesignDoc,
        entityName: "Source Doc",
      },
    });

    renderTarget(buildGoalHostProps());

    await waitFor(() => {
      expect(findGoalDroppable(GOAL_HOST_ID)).toBeDefined();
    });
    const droppable = findGoalDroppable(GOAL_HOST_ID);
    expect(droppable?.disabled).toBe(true);

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
      targetId: GOAL_HOST_ID,
    });

    expect(mockAttach).not.toHaveBeenCalled();
  });

  it("does not attach when another goal is dragged onto a goal host", async () => {
    setActiveDrag({
      type: "entity",
      data: {
        entityId: "other-goal",
        entityType: TargetEntityType.Task,
        entityName: "Other Goal",
        entitySubtype: "GOAL",
      },
    });

    renderTarget(buildGoalHostProps());

    await waitFor(() => {
      expect(findGoalDroppable(GOAL_HOST_ID)).toBeDefined();
    });
    const droppable = findGoalDroppable(GOAL_HOST_ID);
    expect(droppable?.disabled).toBe(true);

    droppable?.data?.onDrop?.({
      content: {
        type: "entity",
        data: {
          entityId: "other-goal",
          entityType: TargetEntityType.Task,
          entityName: "Other Goal",
          entitySubtype: "GOAL",
        },
      },
      sourceId: "src",
      targetId: GOAL_HOST_ID,
    });

    expect(mockAttach).not.toHaveBeenCalled();
  });

  it("resolves silently when re-dropping an already-tracked entity (created:false)", async () => {
    mockAttach.mockResolvedValueOnce({ edge: {}, target: {}, created: false });
    setActiveDrag({
      type: "entity",
      data: {
        entityId: "task-source",
        entityType: TargetEntityType.Task,
        entityName: "Source Task",
        entitySubtype: "STANDARD",
      },
    });

    renderTarget(buildGoalHostProps());

    await waitFor(() => {
      expect(findGoalDroppable(GOAL_HOST_ID)).toBeDefined();
    });
    const droppable = findGoalDroppable(GOAL_HOST_ID);

    droppable?.data?.onDrop?.({
      content: {
        type: "entity",
        data: {
          entityId: "task-source",
          entityType: TargetEntityType.Task,
          entityName: "Source Task",
          entitySubtype: "STANDARD",
        },
      },
      sourceId: "src",
      targetId: GOAL_HOST_ID,
    });

    await waitFor(() => {
      expect(mockAttach).toHaveBeenCalledTimes(1);
    });

    // No error overlay surfaced for the idempotent case.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("does not mount a goal-drop target on a non-goal Task host and TaskDropTarget still registers", async () => {
    setActiveDrag({
      type: "entity",
      data: {
        entityId: "task-source",
        entityType: TargetEntityType.Task,
        entityName: "Source Task",
        entitySubtype: "STANDARD",
      },
    });

    renderTarget(
      buildGoalHostProps({
        entityId: NON_GOAL_TASK_HOST_ID,
        entitySubtype: "STANDARD",
      }),
    );

    await waitFor(() => {
      expect(findTaskDroppable(NON_GOAL_TASK_HOST_ID)).toBeDefined();
    });
    expect(findGoalDroppable(NON_GOAL_TASK_HOST_ID)).toBeUndefined();
  });

  it("does not mount a task drop target on a goal host (the two targets do not co-mount)", async () => {
    renderTarget(buildGoalHostProps());

    await waitFor(() => {
      expect(findGoalDroppable(GOAL_HOST_ID)).toBeDefined();
    });
    expect(findTaskDroppable(GOAL_HOST_ID)).toBeUndefined();
  });
});
