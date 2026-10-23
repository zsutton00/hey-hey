import React from "react";
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoistedMocks = vi.hoisted(() => {
  let rootElement: HTMLElement | null = null;
  const updateFns: Array<() => void> = [];
  const mockEditor = {
    update: vi.fn((fn: () => void) => fn()),
    focus: vi.fn(),
    getRootElement: () => rootElement,
    registerUpdateListener: (listener: () => void) => {
      updateFns.push(listener);
      return () => {};
    },
    registerCommand: () => () => {},
  };
  return {
    mockEditor,
    updateFns,
    setRootElement: (el: HTMLElement | null) => {
      rootElement = el;
    },
    // DnD context mocks
    isDragging: false,
    activeContent: null as unknown,
    isOver: false,
    setNodeRef: vi.fn(),
    insertedMentions: [] as Array<{
      entityType: string;
      entityId: string;
      entityName: string;
    }>,
    insertedTextNodes: [] as string[],
  };
});

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [hoistedMocks.mockEditor],
}));

vi.mock("@dnd-kit/core", () => ({
  useDroppable: (opts: { id: string; data: Record<string, unknown> }) => {
    // Store the data so we can simulate drops
    (hoistedMocks as Record<string, unknown>).droppableData = opts.data;
    return {
      setNodeRef: hoistedMocks.setNodeRef,
      isOver: hoistedMocks.isOver,
    };
  },
}));

vi.mock("../../../contexts/DndContext", () => ({
  useDndContextSafe: () => ({
    activeContent: hoistedMocks.activeContent,
    isDragging: hoistedMocks.isDragging,
    activeSourceId: null,
    setActiveContent: vi.fn(),
    setActiveSourceId: vi.fn(),
    setIsDragging: vi.fn(),
  }),
}));

vi.mock("lexical", async () => {
  const actual = await vi.importActual("lexical");
  return {
    ...actual,
    $createTextNode: (text: string) => ({ __text: text }),
    $getSelection: () => null,
    $isRangeSelection: () => false,
    $isElementNode: () => true,
    $getRoot: () => ({
      getLastChild: () => ({
        append: (...nodes: unknown[]) => {
          for (const node of nodes) {
            if (
              node &&
              typeof node === "object" &&
              "getMention" in (node as Record<string, unknown>)
            ) {
              hoistedMocks.insertedMentions.push(
                (
                  node as {
                    getMention: () => {
                      entityType: string;
                      entityId: string;
                      entityName: string;
                    };
                  }
                ).getMention()
              );
            }
          }
        },
      }),
    }),
  };
});

vi.mock("../MentionNode", () => ({
  $createMentionNode: (mention: {
    entityType: string;
    entityId: string;
    entityName: string;
  }) => ({
    getMention: () => mention,
    __isMock: true,
  }),
}));

// Import after mocks are set up
import { EntityDropPlugin } from "../EntityDropPlugin";

beforeEach(() => {
  hoistedMocks.mockEditor.update.mockClear();
  hoistedMocks.isDragging = false;
  hoistedMocks.activeContent = null;
  hoistedMocks.isOver = false;
  hoistedMocks.insertedMentions = [];
  hoistedMocks.insertedTextNodes = [];
  hoistedMocks.setNodeRef.mockClear();
  hoistedMocks.mockEditor.focus.mockClear();

  const div = document.createElement("div");
  hoistedMocks.setRootElement(div);
});

describe("EntityDropPlugin", () => {
  it("attaches droppable ref to the editor root element", () => {
    render(<EntityDropPlugin />);
    expect(hoistedMocks.setNodeRef).toHaveBeenCalled();
  });

  it("does not show drop indicator text when no entity is being dragged", () => {
    const { container } = render(<EntityDropPlugin />);
    expect(container.textContent).not.toContain("Drop to mention");
  });

  it("renders drop indicator when entity is dragged over", () => {
    hoistedMocks.isDragging = true;
    hoistedMocks.activeContent = {
      type: "entity",
      data: { entityId: "e-1", entityType: "TASK", entityName: "My Task" },
    };
    hoistedMocks.isOver = true;

    const { container } = render(<EntityDropPlugin />);
    expect(container.textContent).toContain("Drop to mention");
  });

  it("does not render drop indicator for non-entity drag", () => {
    hoistedMocks.isDragging = true;
    hoistedMocks.activeContent = {
      type: "file",
      data: { name: "test.txt" },
    };
    hoistedMocks.isOver = true;

    const { container } = render(<EntityDropPlugin />);
    expect(container.textContent).not.toContain("Drop to mention");
  });

  it("inserts a MentionNode when an entity is dropped via onDrop callback", () => {
    hoistedMocks.isDragging = true;
    hoistedMocks.activeContent = {
      type: "entity",
      data: { entityId: "e-1", entityType: "TASK", entityName: "My Task" },
    };
    hoistedMocks.isOver = true;

    render(<EntityDropPlugin />);

    const droppableData = (hoistedMocks as Record<string, unknown>)
      .droppableData as {
      onDrop: (event: {
        content: { type: string; data: Record<string, string> };
      }) => void;
    };

    act(() => {
      droppableData.onDrop({
        content: {
          type: "entity",
          data: {
            entityId: "e-1",
            entityType: "TASK",
            entityName: "My Task",
          },
        },
      });
    });

    expect(hoistedMocks.insertedMentions).toHaveLength(1);
    expect(hoistedMocks.insertedMentions[0]).toEqual({
      entityType: "TASK",
      entityId: "e-1",
      entityName: "My Task",
    });
  });

  it("inserts a canonical Agent Session mention with the source identity and label", () => {
    const agentSessionId = "ddc6ca2e-c8b5-401a-a2fd-ef88bbd295cf";
    const agentSessionName = "Review release notes";
    hoistedMocks.isDragging = true;
    hoistedMocks.activeContent = {
      type: "entity",
      data: {
        entityId: agentSessionId,
        entityType: "AGENT_SESSION",
        entityName: agentSessionName,
      },
    };
    hoistedMocks.isOver = true;

    render(<EntityDropPlugin />);

    const droppableData = (hoistedMocks as Record<string, unknown>)
      .droppableData as {
      onDrop: (event: {
        content: { type: string; data: Record<string, string> };
      }) => void;
    };

    act(() => {
      droppableData.onDrop({
        content: {
          type: "entity",
          data: {
            entityId: agentSessionId,
            entityType: "AGENT_SESSION",
            entityName: agentSessionName,
          },
        },
      });
    });

    expect(hoistedMocks.insertedMentions).toEqual([
      {
        entityType: "agent_session",
        entityId: agentSessionId,
        entityName: agentSessionName,
      },
    ]);
  });

  it("focuses the editor when entity drag enters", () => {
    hoistedMocks.isDragging = true;
    hoistedMocks.activeContent = {
      type: "entity",
      data: { entityId: "e-1", entityType: "TASK", entityName: "My Task" },
    };
    hoistedMocks.isOver = true;

    render(<EntityDropPlugin />);
    expect(hoistedMocks.mockEditor.focus).toHaveBeenCalled();
  });
});

it("inserts all batch mentions in one editor update", () => {
  const data = [
    { entityId: "one", entityType: "TASK", entityName: "One" },
    { entityId: "two", entityType: "DESIGN_DOC", entityName: "Two" },
  ];
  render(<EntityDropPlugin />);
  const target = (hoistedMocks as Record<string, unknown>).droppableData as {
    onDrop: (event: { content: import("../../../types/dragAndDrop").DraggableContent }) => void;
  };
  act(() => target.onDrop({ content: { type: "entities", data: [data[0], data[1]] } }));
  expect(hoistedMocks.mockEditor.update).toHaveBeenCalledTimes(1);
  expect(hoistedMocks.insertedMentions).toEqual(data);
});
