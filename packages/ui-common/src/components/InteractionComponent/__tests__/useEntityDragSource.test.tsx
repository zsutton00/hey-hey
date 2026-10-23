import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  DndContext,
  type DragStartEvent as DndKitDragStartEvent,
} from "@dnd-kit/core";
import {
  useEntityDragSource,
  type UseEntityDragSourceInput,
} from "../useEntityDragSource";

interface HarnessProps extends UseEntityDragSourceInput {
  onResult?: (result: ReturnType<typeof useEntityDragSource>) => void;
}

function Harness({ onResult, ...input }: HarnessProps) {
  const result = useEntityDragSource(input);
  onResult?.(result);
  return (
    <div
      ref={result.setNodeRef}
      data-testid="drag-source"
      data-drag-id={result.dragId}
      {...result.attributes}
      {...result.listeners}
    >
      drag me
    </div>
  );
}

function renderHarness(
  input: UseEntityDragSourceInput,
  onDragStart?: (event: DndKitDragStartEvent) => void
) {
  const resultRef: { current: ReturnType<typeof useEntityDragSource> | null } =
    {
      current: null,
    };
  render(
    <DndContext onDragStart={onDragStart}>
      <Harness
        {...input}
        onResult={(r) => {
          resultRef.current = r;
        }}
      />
    </DndContext>
  );
  return resultRef;
}

describe("useEntityDragSource", () => {
  it("builds dragId without idScope", () => {
    renderHarness({
      entityRef: { entityId: "abc", entityType: "TASK" },
    });
    expect(screen.getByTestId("drag-source")).toHaveAttribute(
      "data-drag-id",
      "interaction-abc"
    );
  });

  it("builds dragId with idScope", () => {
    renderHarness({
      entityRef: { entityId: "abc", entityType: "TASK" },
      idScope: "list-1",
    });
    expect(screen.getByTestId("drag-source")).toHaveAttribute(
      "data-drag-id",
      "interaction-abc-list-1"
    );
  });

  it("returns attributes, listeners, and a working setNodeRef", () => {
    const ref = renderHarness({
      entityRef: { entityId: "abc", entityType: "TASK" },
    });
    const el = screen.getByTestId("drag-source");
    expect(ref.current).not.toBeNull();
    expect(ref.current!.attributes).toBeDefined();
    expect(ref.current!.listeners).toBeDefined();
    // setNodeRef should have wired the DOM node into dnd-kit; dnd-kit applies
    // a role to the node when registered.
    expect(el.getAttribute("role")).toBe("button");
  });

  it("uses entityTitle as entityName when provided", () => {
    const onDragStart = vi.fn();
    renderHarness(
      {
        entityRef: {
          entityId: "abc",
          entityType: "TASK",
          entityTitle: "My Task",
          entitySubtype: "STANDARD",
        },
      },
      onDragStart
    );
    const el = screen.getByTestId("drag-source");
    fireEvent.keyDown(el, { code: "Space" });
    expect(onDragStart).toHaveBeenCalledTimes(1);
    const event = onDragStart.mock.calls[0][0] as DndKitDragStartEvent;
    const data = event.active.data.current as {
      content: { type: string; data: Record<string, unknown> };
      sourceId: string;
    };
    expect(data.sourceId).toBe("interaction-abc");
    expect(data.content.type).toBe("entity");
    expect(data.content.data).toEqual({
      entityId: "abc",
      entityType: "TASK",
      entityName: "My Task",
      entitySubtype: "STANDARD",
    });
  });

  it("falls back entityName to entityType when entityTitle is omitted", () => {
    const onDragStart = vi.fn();
    renderHarness(
      {
        entityRef: { entityId: "abc", entityType: "TASK" },
      },
      onDragStart
    );
    const el = screen.getByTestId("drag-source");
    fireEvent.keyDown(el, { code: "Space" });
    const event = onDragStart.mock.calls[0][0] as DndKitDragStartEvent;
    const data = event.active.data.current as {
      content: { data: { entityName: string } };
    };
    expect(data.content.data.entityName).toBe("TASK");
  });

  it("does not start a drag when disabled is true", () => {
    const onDragStart = vi.fn();
    renderHarness(
      {
        entityRef: { entityId: "abc", entityType: "TASK" },
        disabled: true,
      },
      onDragStart
    );
    const el = screen.getByTestId("drag-source");
    fireEvent.keyDown(el, { code: "Space" });
    expect(onDragStart).not.toHaveBeenCalled();
  });
});

it("registers the resolved batch intact and cancels without a drop", async () => {
  const onDragStart = vi.fn();
  const onDragCancel = vi.fn();
  const onDragEnd = vi.fn();
  const content = { type: "entities", data: [
    { entityId: "one", entityType: "TASK", entityName: "One" },
    { entityId: "two", entityType: "DESIGN_DOC", entityName: "Two" },
  ] } as const;
  render(<DndContext onDragStart={onDragStart} onDragCancel={onDragCancel} onDragEnd={onDragEnd}>
    <Harness entityRef={{ entityId: "one", entityType: "TASK" }} content={content} />
  </DndContext>);
  fireEvent.keyDown(screen.getByTestId("drag-source"), { code: "Space" });
  expect(onDragStart).toHaveBeenCalledTimes(1);
  expect(onDragStart.mock.calls[0][0].active.data.current.content).toEqual(content);
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireEvent.keyDown(document, { code: "Escape" });
  expect(onDragCancel).toHaveBeenCalledTimes(1);
  expect(onDragEnd).not.toHaveBeenCalled();
});
