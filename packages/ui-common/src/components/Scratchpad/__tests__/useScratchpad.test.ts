import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { Provider, createStore } from "jotai";
import { useScratchpad } from "../useScratchpad";
import type { DraggableContent } from "../../../types/dragAndDrop";

const entityContent: DraggableContent = {
  type: "entity",
  data: { entityId: "task-1", entityType: "TASK", entityName: "My Task" },
};

const conversationContent: DraggableContent = {
  type: "conversation",
  data: { id: "conv-1", title: "Chat" } as any,
};

const initiativeContent: DraggableContent = {
  type: "initiative",
  data: { id: "init-1", name: "Goal" } as any,
};

const fileContent: DraggableContent = {
  type: "file",
  data: {
    file: new File([], "test.txt"),
    id: "file-1",
    name: "test.txt",
    size: 0,
    type: "text/plain",
    lastModified: 0,
  },
};

function renderWithStore() {
  const store = createStore();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(Provider, { store }, children);
  return renderHook(() => useScratchpad(), { wrapper });
}

describe("useScratchpad", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds a complete mixed batch once, preserving type-qualified identity", () => {
    const { result } = renderWithStore();
    const first = { entityId: "same", entityType: "TASK", entityName: "Task" };
    const second = { entityId: "same", entityType: "DESIGN_DOC", entityName: "Doc" };
    act(() => result.current.addFromDrag({ type: "entities", data: [first, second, first] }));
    expect(result.current.items.map(({ entityId, entityType }) => ({ entityId, entityType })))
      .toEqual([{ entityId: "same", entityType: "TASK" }, { entityId: "same", entityType: "DESIGN_DOC" }]);
    act(() => result.current.addFromDrag({ type: "entities", data: [first, second] }));
    expect(result.current.items).toHaveLength(2);
  });

  it("starts with an empty collection", () => {
    const { result } = renderWithStore();
    expect(result.current.items).toEqual([]);
  });

  it("adds an entity from drag content", () => {
    const { result } = renderWithStore();

    act(() => {
      result.current.addFromDrag(entityContent);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].entityId).toBe("task-1");
    expect(result.current.items[0].entityType).toBe("TASK");
    expect(result.current.items[0].entityName).toBe("My Task");
  });

  it("preserves the canonical Agent Session identity in its stored entity record", () => {
    const agentSessionId = "cbd46662-06ca-4b88-b520-0e41950e9c66";
    const agentSessionName = "Review release notes";
    const agentSessionContent: DraggableContent = {
      type: "entity",
      data: {
        entityId: agentSessionId,
        entityType: "AGENT_SESSION",
        entityName: agentSessionName,
      },
    };
    const { result } = renderWithStore();

    act(() => {
      result.current.addFromDrag(agentSessionContent);
    });

    expect(result.current.items).toMatchObject([
      {
        entityId: agentSessionId,
        entityType: "AGENT_SESSION",
        entityName: agentSessionName,
        sourceContentType: "entity",
      },
    ]);
    expect(
      JSON.parse(localStorage.getItem("hey-scratchpad-items") ?? "[]")
    ).toMatchObject([
      {
        entityId: agentSessionId,
        entityType: "AGENT_SESSION",
        entityName: agentSessionName,
      },
    ]);
  });

  it("adds a conversation from drag content", () => {
    const { result } = renderWithStore();

    act(() => {
      result.current.addFromDrag(conversationContent);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].entityId).toBe("conv-1");
    expect(result.current.items[0].entityType).toBe("conversation");
  });

  it("adds an initiative from drag content", () => {
    const { result } = renderWithStore();

    act(() => {
      result.current.addFromDrag(initiativeContent);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].entityId).toBe("init-1");
  });

  it("ignores file drag content", () => {
    const { result } = renderWithStore();

    act(() => {
      result.current.addFromDrag(fileContent);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("deduplicates by entityId and entityType", () => {
    const { result } = renderWithStore();

    act(() => {
      result.current.addFromDrag(entityContent);
    });
    act(() => {
      result.current.addFromDrag(entityContent);
    });

    expect(result.current.items).toHaveLength(1);
  });

  it("removes an item by entityId", () => {
    const { result } = renderWithStore();

    act(() => {
      result.current.addFromDrag(entityContent);
    });
    act(() => {
      result.current.removeItem("task-1");
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("reorders items", () => {
    const { result } = renderWithStore();

    const second: DraggableContent = {
      type: "entity",
      data: { entityId: "task-2", entityType: "TASK", entityName: "Second" },
    };

    act(() => {
      result.current.addFromDrag(entityContent);
    });
    act(() => {
      result.current.addFromDrag(second);
    });
    act(() => {
      result.current.reorderItems(0, 1);
    });

    expect(result.current.items[0].entityId).toBe("task-2");
    expect(result.current.items[1].entityId).toBe("task-1");
  });

  it("clears all items", () => {
    const { result } = renderWithStore();

    act(() => {
      result.current.addFromDrag(entityContent);
    });
    act(() => {
      result.current.addFromDrag(conversationContent);
    });
    act(() => {
      result.current.clearAll();
    });

    expect(result.current.items).toHaveLength(0);
  });
});
