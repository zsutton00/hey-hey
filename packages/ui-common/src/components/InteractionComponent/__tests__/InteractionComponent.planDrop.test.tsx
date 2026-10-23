import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DndContext as CoreDndContext } from "@dnd-kit/core";
import { Provider, createStore } from "jotai";
import { TargetEntityType } from "../../../api";
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

const mockDraggedPlan: {
  current: { id: string; parentTaskId?: string } | null;
} = { current: null };
vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: vi.fn((_organizationId, _entityType, workItemId: string) => ({
    workItem:
      mockDraggedPlan.current?.id === workItemId
        ? mockDraggedPlan.current
        : null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
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

const mockUpdatePlan = vi.fn();
vi.mock("../../../data/hooks/useCanonicalPlanMutations", () => ({
  useCanonicalPlanMutations: vi.fn(() => ({ updatePlan: mockUpdatePlan })),
}));

// A feature host also mounts TaskDropTarget and DesignDocDropTarget; their
// hooks are stubbed so this suite isolates the plan drop path.
const mockReparent = vi.fn();
vi.mock("../../../data/hooks/useReparentDesignDoc", () => ({
  useReparentDesignDoc: vi.fn(() => ({ reparent: mockReparent })),
}));

const mockUpdateTask = vi.fn();
vi.mock("../../../data/hooks/useWorkItemUpdateMethods", () => ({
  useWorkItemUpdateMethods: vi.fn(() => ({ updateTask: mockUpdateTask })),
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

const FEATURE_HOST_ID = "feature-host";

function buildFeatureHostProps(
  overrides: Partial<InteractionComponentProps> = {},
): InteractionComponentProps {
  return {
    entityId: FEATURE_HOST_ID,
    entityType: TargetEntityType.Task,
    entitySubtype: "FEATURE",
    hasProposalSupport: true,
    organizationId: "org-1",
    projectId: "proj-1",
    children: <div data-testid="child-content">child</div>,
    ...overrides,
  };
}

function renderTarget(props: InteractionComponentProps) {
  return render(
    <Provider store={createStore()}>
      <CoreDndContext>
        <InteractionComponent {...props} />
      </CoreDndContext>
    </Provider>,
  );
}

function findPlanDroppable(entityId: string) {
  return droppableRegistrations.find(
    (reg) =>
      reg.id === `interaction-plan-drop-${entityId}` ||
      reg.id.startsWith(`interaction-plan-drop-${entityId}-`),
  );
}

function setActiveDrag(content: ActiveDrag) {
  mockDndState.activeContent = content;
  mockDndState.isDragging = content !== null;
  mockDndState.activeSourceId = content
    ? `interaction-${content.data.entityId}`
    : null;
}

const planDragContent = {
  type: "entity" as const,
  data: {
    entityId: "plan-source",
    entityType: TargetEntityType.Task,
    entitySubtype: "PLAN",
    entityName: "Source Plan",
  },
};

beforeEach(() => {
  droppableRegistrations.length = 0;
  mockUpdatePlan.mockReset();
  mockUpdatePlan.mockResolvedValue(undefined);
  mockReparent.mockReset();
  mockReparent.mockResolvedValue(undefined);
  mockUpdateTask.mockReset();
  mockDraggedPlan.current = null;
  setActiveDrag(null);
});

describe("InteractionComponent — plan drop target", () => {
  it("rejects plan batches on both the plan target and the generic task target", async () => {
    const content = { type: "entities", data: [
      { entityId: "first", entityType: TargetEntityType.Task, entitySubtype: "PLAN", entityName: "First" },
      { entityId: "second", entityType: TargetEntityType.Task, entitySubtype: "PLAN", entityName: "Second" },
    ] } as const;
    setActiveDrag(content);
    renderTarget(buildFeatureHostProps());
    await waitFor(() => expect(findPlanDroppable(FEATURE_HOST_ID)).toBeDefined());
    const targets = droppableRegistrations.filter((target) =>
      target.id.startsWith("interaction-plan-drop-") || target.id.startsWith("interaction-task-drop-"));
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.disabled).toBe(true);
      target.data?.onDrop?.({ content });
    }
    expect(mockUpdatePlan).not.toHaveBeenCalled();
    expect(mockUpdateTask).not.toHaveBeenCalled();
  });

  it("reparents a dropped plan beneath the feature host", async () => {
    setActiveDrag(planDragContent);
    renderTarget(buildFeatureHostProps());

    await waitFor(() => {
      expect(findPlanDroppable(FEATURE_HOST_ID)).toBeDefined();
    });
    const droppable = findPlanDroppable(FEATURE_HOST_ID);
    expect(droppable?.disabled).toBe(false);

    droppable?.data?.onDrop?.({
      content: planDragContent,
      sourceId: "src",
      targetId: FEATURE_HOST_ID,
    });

    expect(mockUpdatePlan).toHaveBeenCalledWith("plan-source", {
      parentTaskId: FEATURE_HOST_ID,
    });
  });

  it("is a no-op when the plan already sits under the feature host", async () => {
    mockDraggedPlan.current = {
      id: "plan-source",
      parentTaskId: FEATURE_HOST_ID,
    };
    setActiveDrag(planDragContent);
    renderTarget(buildFeatureHostProps());

    await waitFor(() => {
      expect(findPlanDroppable(FEATURE_HOST_ID)).toBeDefined();
    });

    findPlanDroppable(FEATURE_HOST_ID)?.data?.onDrop?.({
      content: planDragContent,
      sourceId: "src",
      targetId: FEATURE_HOST_ID,
    });

    expect(mockUpdatePlan).not.toHaveBeenCalled();
  });

  it("surfaces an error tooltip when the reparent fails", async () => {
    mockUpdatePlan.mockRejectedValueOnce(new Error("Plan move failed"));
    setActiveDrag(planDragContent);
    renderTarget(buildFeatureHostProps());

    await waitFor(() => {
      expect(findPlanDroppable(FEATURE_HOST_ID)).toBeDefined();
    });

    // The drag has ended by the time the async failure resolves; otherwise
    // the new-drag effect would clear the error before it can surface.
    mockDndState.isDragging = false;

    findPlanDroppable(FEATURE_HOST_ID)?.data?.onDrop?.({
      content: planDragContent,
      sourceId: "src",
      targetId: FEATURE_HOST_ID,
    });

    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("Plan move failed");
    });
  });

  it("ignores drops whose payload is not a plan entity", async () => {
    setActiveDrag(planDragContent);
    renderTarget(buildFeatureHostProps());

    await waitFor(() => {
      expect(findPlanDroppable(FEATURE_HOST_ID)).toBeDefined();
    });

    findPlanDroppable(FEATURE_HOST_ID)?.data?.onDrop?.({
      content: {
        type: "entity",
        data: {
          entityId: "task-source",
          entityType: TargetEntityType.Task,
          entityName: "Source Task",
        },
      },
      sourceId: "src",
      targetId: FEATURE_HOST_ID,
    });

    expect(mockUpdatePlan).not.toHaveBeenCalled();
  });

  it("does not mount a plan drop target on a non-feature Task host", async () => {
    setActiveDrag(planDragContent);
    renderTarget(
      buildFeatureHostProps({
        entityId: "standard-task",
        entitySubtype: "STANDARD",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("child-content")).toBeInTheDocument();
    });
    expect(findPlanDroppable("standard-task")).toBeUndefined();
  });
});
