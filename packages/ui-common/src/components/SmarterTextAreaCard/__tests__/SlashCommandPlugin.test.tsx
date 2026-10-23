import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEY_TAB_COMMAND, PASTE_COMMAND } from "lexical";
import type { Command } from "../slashCommands/types";
import { FEATURE_TREE_PICKER } from "../slashCommands/types";
import type { InlineSearchResultsFreshness } from "../inlineSearchResults";
import type { EntitySearchScope, SearchEntity } from "../types";

interface MockTextNode {
  nodeType: "text";
  getTextContent: () => string;
  getKey: () => string;
}

interface MockDecoratorNode {
  nodeType: "decorator";
  getTextContent: () => string;
  getKey: () => string;
}

type MockDfsNode = MockTextNode | MockDecoratorNode;

const hoistedMocks = vi.hoisted(() => {
  const updateListeners: Array<() => void> = [];
  const commandRegistrations: Array<{
    command: unknown;
    listener: (event: KeyboardEvent | ClipboardEvent | null) => boolean;
  }> = [];
  const rootElement = document.createElement("div");
  const searchCommand: Command = {
    id: "hey-hey-builtin:search",
    name: "search",
    description: "Open advanced search",
    kind: "open-modal",
    source: "hey-hey-builtin",
    argShape: "query",
    modal: "search",
  };
  const featureTreeCommand: Command = {
    id: "hey-hey-builtin:feature-tree",
    name: "feature-tree",
    description: "Open the feature tree",
    kind: "open-picker",
    source: "hey-hey-builtin",
    argShape: "none",
    picker: "feature-tree",
  };
  const skillCommand: Command = {
    id: "hey-hey-builtin:skill",
    name: "skill",
    description: "Use an installed Codex Skill",
    kind: "open-skill-picker",
    source: "hey-hey-builtin",
    argShape: "none",
    picker: "skill-picker",
  };
  const featureCommand: Command = {
    id: "hey-hey-builtin:work-item-type:FEATURE",
    name: "feature",
    description: "Insert a feature reference",
    kind: "inline-entity-search",
    source: "hey-hey-builtin",
    argShape: "entity",
    typeRef: "FEATURE",
    typeRefKind: "work-item-type",
  };
  const contractCommand: Command = {
    id: "hey-hey-builtin:work-item-type:CONTRACT",
    name: "contract",
    description: "Insert a contract reference",
    kind: "inline-entity-search",
    source: "hey-hey-builtin",
    argShape: "entity",
    typeRef: "CONTRACT",
    typeRefKind: "work-item-type",
  };
  const taskCommand: Command = {
    id: "hey-hey-builtin:work-item-type:TASK",
    name: "task",
    description: "Search tasks",
    kind: "inline-entity-search",
    source: "hey-hey-builtin",
    argShape: "entity",
    typeRef: "TASK",
    typeRefKind: "work-item-type",
  };
  let textContent = "/search";
  let selectionOffset = 7;
  let replacementStart: number | null = null;
  let replacementNodeIndex: number | null = null;
  let anchorNodeIndex = 0;
  let lastReplacementNodeKey: string | null = null;
  let textSegments = [textContent];
  let decoratorAfterSegment: { segmentIndex: number; text: string } | null =
    null;
  let lastSearchPopupProps: {
    query: string;
    searchScope: EntitySearchScope;
    onSelectEntity: (entity: SearchEntity) => void;
    onViewAll?: () => void;
    onViewAllAvailabilityChange?: (available: boolean) => void;
    onResultsChange: (
      results: SearchEntity[],
      freshness: InlineSearchResultsFreshness,
    ) => void;
  } | null = null;
  const textNodes: MockTextNode[] = [];
  const dfsNodes: MockDfsNode[] = [];
  const rebuildTextNodes = () => {
    textNodes.length = 0;
    dfsNodes.length = 0;
    textSegments.forEach((_, index) => {
      const textNode: MockTextNode = {
        nodeType: "text",
        getTextContent: () => textSegments[index],
        getKey: () => `slash-node-${index + 1}`,
      };
      textNodes.push(textNode);
      dfsNodes.push(textNode);
      if (decoratorAfterSegment?.segmentIndex === index) {
        const decoratorText = decoratorAfterSegment.text;
        dfsNodes.push({
          nodeType: "decorator",
          getTextContent: () => decoratorText,
          getKey: () => "slash-decorator-1",
        });
      }
    });
  };
  rebuildTextNodes();
  const mockSelection = {
    isCollapsed: () => true,
    anchor: {
      getNode: () => textNodes[anchorNodeIndex],
      get offset() {
        return selectionOffset;
      },
      set: (key: string, offset: number) => {
        replacementNodeIndex = textNodes.findIndex(
          (node) => node.getKey() === key,
        );
        lastReplacementNodeKey = key;
        replacementStart = offset;
      },
    },
    insertText: (newText: string) => {
      if (
        replacementNodeIndex !== null &&
        replacementNodeIndex !== anchorNodeIndex
      ) {
        const start =
          replacementStart ?? textSegments[replacementNodeIndex].length;
        textSegments[replacementNodeIndex] = `${textSegments[
          replacementNodeIndex
        ].slice(0, start)}${newText}`;
        textSegments[anchorNodeIndex] =
          textSegments[anchorNodeIndex].slice(selectionOffset);
        textContent = textSegments.join("");
        selectionOffset = newText.length;
        replacementStart = null;
        replacementNodeIndex = null;
        return;
      }
      const start = replacementStart ?? selectionOffset;
      textSegments[anchorNodeIndex] = `${textSegments[anchorNodeIndex].slice(
        0,
        start,
      )}${newText}${textSegments[anchorNodeIndex].slice(selectionOffset)}`;
      textContent = textSegments.join("");
      selectionOffset = start + newText.length;
      replacementStart = null;
      replacementNodeIndex = null;
    },
  };
  const mockEditor = {
    update: (fn: () => void) => fn(),
    getEditorState: () => ({
      read: (fn: () => void) => fn(),
    }),
    getRootElement: () => rootElement,
    registerCommand: (
      command: unknown,
      listener: (event: KeyboardEvent | ClipboardEvent | null) => boolean,
    ) => {
      commandRegistrations.push({ command, listener });
      return () => {
        const index = commandRegistrations.findIndex(
          (registration) =>
            registration.command === command &&
            registration.listener === listener,
        );
        if (index >= 0) commandRegistrations.splice(index, 1);
      };
    },
    registerUpdateListener: (listener: () => void) => {
      updateListeners.push(listener);
      return () => {};
    },
  };
  const selectionRect: DOMRect = {
    x: 32,
    y: 48,
    top: 48,
    left: 32,
    right: 96,
    bottom: 66,
    width: 64,
    height: 18,
    toJSON: () => ({}),
  } as DOMRect;
  return {
    mockEditor,
    mockSelection,
    contractCommand,
    featureCommand,
    featureTreeCommand,
    skillCommand,
    searchCommand,
    taskCommand,
    rootElement,
    selectionRect,
    setEditorText: (text: string, offset: number) => {
      textContent = text;
      textSegments = [text];
      decoratorAfterSegment = null;
      anchorNodeIndex = 0;
      selectionOffset = offset;
      replacementStart = null;
      replacementNodeIndex = null;
      lastReplacementNodeKey = null;
      rebuildTextNodes();
    },
    setEditorTextSegments: (
      segments: string[],
      anchorIndex: number,
      offset: number,
    ) => {
      textSegments = segments;
      textContent = segments.join("");
      decoratorAfterSegment = null;
      anchorNodeIndex = anchorIndex;
      selectionOffset = offset;
      replacementStart = null;
      replacementNodeIndex = null;
      lastReplacementNodeKey = null;
      rebuildTextNodes();
    },
    setEditorTextSegmentsWithDecorator: (
      segments: string[],
      anchorIndex: number,
      offset: number,
      decoratorAfterSegmentIndex: number,
      decoratorText: string,
    ) => {
      textSegments = segments;
      textContent = segments.join("");
      decoratorAfterSegment = {
        segmentIndex: decoratorAfterSegmentIndex,
        text: decoratorText,
      };
      anchorNodeIndex = anchorIndex;
      selectionOffset = offset;
      replacementStart = null;
      replacementNodeIndex = null;
      lastReplacementNodeKey = null;
      rebuildTextNodes();
    },
    get textNode() {
      return textNodes[anchorNodeIndex];
    },
    get textContent() {
      return textContent;
    },
    get textNodes() {
      return textNodes;
    },
    get textSegments() {
      return textSegments;
    },
    get dfsNodes() {
      return dfsNodes;
    },
    updateListeners,
    commandRegistrations,
    dispatchTabCommand: () => {
      const event = new KeyboardEvent("keydown", { key: "Tab" });
      return commandRegistrations
        .filter((registration) => registration.command === KEY_TAB_COMMAND)
        .some((registration) => registration.listener(event));
    },
    dispatchPasteCommand: (text: string) => {
      const event = {
        clipboardData: {
          getData: (type: string) => (type === "text/plain" ? text : ""),
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      return commandRegistrations
        .filter((registration) => registration.command === PASTE_COMMAND)
        .some((registration) => registration.listener(event));
    },
    get lastReplacementNodeKey() {
      return lastReplacementNodeKey;
    },
    searchResult: {
      id: "task-1",
      type: "task",
      name: "Task One",
    },
    get lastSearchPopupProps() {
      return lastSearchPopupProps;
    },
    setSearchPopupProps: (props: {
      query: string;
      searchScope: EntitySearchScope;
      onSelectEntity: (entity: SearchEntity) => void;
      onViewAll?: () => void;
      onResultsChange: (
        results: SearchEntity[],
        freshness: InlineSearchResultsFreshness,
      ) => void;
    }) => {
      lastSearchPopupProps = props;
    },
    resetSearchPopupProps: () => {
      lastSearchPopupProps = null;
    },
  };
});

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [hoistedMocks.mockEditor],
}));

vi.mock("lexical", async () => {
  const actual = await vi.importActual<typeof import("lexical")>("lexical");
  return {
    ...actual,
    $getRoot: () => ({}),
    $getSelection: () => hoistedMocks.mockSelection,
    $isRangeSelection: () => true,
    $isTextNode: (node: unknown) =>
      typeof node === "object" &&
      node !== null &&
      "nodeType" in node &&
      node.nodeType === "text",
    $isDecoratorNode: (node: unknown) =>
      typeof node === "object" &&
      node !== null &&
      "nodeType" in node &&
      node.nodeType === "decorator",
  };
});

vi.mock("@lexical/utils", () => ({
  $dfs: () => hoistedMocks.dfsNodes.map((node) => ({ node })),
}));

vi.mock("../slashCommands/useSlashCommandRegistry", () => ({
  useSlashCommandRegistry: ({
    query,
    agentContext,
    surfaceContext,
  }: {
    query: string;
    agentContext?: { provider: string } | null;
    surfaceContext?: { unavailableSkillCommandReason?: string };
  }) => {
    const normalizedQuery = query.startsWith("/") ? query.slice(1) : query;
    const skillCommand =
      agentContext?.provider === "codex"
        ? hoistedMocks.skillCommand
        : surfaceContext?.unavailableSkillCommandReason
          ? {
              ...hoistedMocks.skillCommand,
              availability: {
                state: "disabled" as const,
                reason: surfaceContext.unavailableSkillCommandReason,
              },
            }
          : null;
    const heyHey = [
      hoistedMocks.searchCommand,
      hoistedMocks.contractCommand,
      hoistedMocks.taskCommand,
      hoistedMocks.featureCommand,
      hoistedMocks.featureTreeCommand,
      ...(skillCommand ? [skillCommand] : []),
    ].filter((command) => command.name.startsWith(normalizedQuery));
    return {
      heyHey,
    };
  },
}));

vi.mock("../slashCommands/SlashCommandPopup", () => ({
  SLASH_COMMAND_POPUP_WIDTH: 360,
  SlashCommandPopup: ({
    heyHey,
    selectedIndex = -1,
    query,
    mode,
    onSelectedIndexChange,
    onPickCommand,
  }: {
    heyHey: Command[];
    selectedIndex?: number;
    query: string;
    mode: string;
    onSelectedIndexChange?: (index: number) => void;
    onPickCommand: (command: Command) => void;
  }) => (
    <div data-testid="slash-command-popup">
      <div data-testid="slash-command-query">{query}</div>
      <div data-testid="slash-command-mode">{mode}</div>
      {heyHey.map((command, index) => (
        <button
          key={command.id}
          type="button"
          disabled={command.availability?.state === "disabled"}
          data-testid={`slash-command-pick-${command.name}`}
          aria-selected={index === selectedIndex}
          onMouseEnter={() => onSelectedIndexChange?.(index)}
          onClick={() => onPickCommand(command)}
        >
          /{command.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../slashCommands/SlashEntitySearchPopup", () => ({
  SlashEntitySearchPopup: ({
    query,
    searchScope,
    onSelectEntity,
    onResultsChange,
    onViewAll,
    onViewAllAvailabilityChange,
  }: {
    query: string;
    searchScope: EntitySearchScope;
    onSelectEntity: (entity: SearchEntity) => void;
    onViewAll?: () => void;
    onViewAllAvailabilityChange?: (available: boolean) => void;
    onResultsChange: (
      results: SearchEntity[],
      freshness: InlineSearchResultsFreshness,
    ) => void;
  }) => {
    React.useEffect(() => {
      onViewAllAvailabilityChange?.(Boolean(onViewAll));
      return () => onViewAllAvailabilityChange?.(false);
    }, [onViewAll, onViewAllAvailabilityChange]);
    hoistedMocks.setSearchPopupProps({
      query,
      searchScope,
      onSelectEntity,
      onResultsChange,
      onViewAll,
      onViewAllAvailabilityChange,
    });
    return (
      <div data-testid="slash-entity-search-popup">
        <div data-testid="slash-entity-search-query">{query}</div>
        <button
          type="button"
          data-testid="slash-entity-search-select"
          onClick={() => onSelectEntity(hoistedMocks.searchResult)}
        >
          Select
        </button>
        {onViewAll && (
          <button
            type="button"
            data-testid="slash-entity-search-view"
            onClick={onViewAll}
          >
            View all
          </button>
        )}
      </div>
    );
  },
}));

import { SlashCommandPlugin } from "../slashCommands/SlashCommandPlugin";

beforeEach(() => {
  hoistedMocks.updateListeners.length = 0;
  hoistedMocks.commandRegistrations.length = 0;
  hoistedMocks.setEditorText("/search", 7);
  hoistedMocks.resetSearchPopupProps();
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 1,
    getRangeAt: () => ({
      getBoundingClientRect: () => hoistedMocks.selectionRect,
    }),
  } as unknown as Selection);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SlashCommandPlugin", () => {
  it("renders the Tab cue next to the typed command text instead of inside the popup", async () => {
    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    const cue = screen.getByTestId("slash-command-tab-cue");
    expect(cue).toHaveTextContent("[Tab]");
    expect(cue).toHaveStyle({
      position: "fixed",
      top: "48px",
      left: "100px",
    });
    expect(screen.getByTestId("slash-command-popup")).toBeInTheDocument();
  });

  it("emits a Skill picker request without turning the slash command into prompt text", async () => {
    const onPickerEmit = vi.fn();
    hoistedMocks.setEditorText("/skill", 6);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        agentContext={{ provider: "codex" }}
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.click(screen.getByTestId("slash-command-pick-skill"));

    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "openSkillPicker",
      picker: "skill-picker",
      replacementRange: {
        nodeKey: "slash-node-1",
        sliceStart: 0,
        cursorOffset: 6,
      },
    });
    expect(hoistedMocks.textContent).toBe("/skill");
  });

  it("keeps a pre-run Skill command disabled for mouse and keyboard selection", async () => {
    const onPickerEmit = vi.fn();
    hoistedMocks.setEditorText("/skill", 6);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
          unavailableSkillCommandReason:
            "Start a Codex conversation to browse installed Skills.",
        }}
        onPickerEmit={onPickerEmit}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    const skillButton = screen.getByTestId("slash-command-pick-skill");
    expect(skillButton).toBeDisabled();

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });

    expect(onPickerEmit).not.toHaveBeenCalled();
    expect(hoistedMocks.textContent).toBe("/skill");
  });

  it("opens entity-insertion-only slash commands after existing text", async () => {
    hoistedMocks.setEditorText("prefix/", 7);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          commandSurface: "entity-insertion-only",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(screen.getByTestId("slash-command-popup")).toBeInTheDocument();
  });

  it("keeps Tab completion anchored to the text node containing the slash", async () => {
    hoistedMocks.setEditorTextSegments(["Existing title", "/s"], 1, 2);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          commandSurface: "entity-insertion-only",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(screen.getByTestId("slash-command-popup")).toBeInTheDocument();

    await act(async () => {
      expect(hoistedMocks.dispatchTabCommand()).toBe(true);
    });

    expect(hoistedMocks.lastReplacementNodeKey).toBe("slash-node-2");
  });

  it("completes a command after decorator text and preserves preceding content", async () => {
    hoistedMocks.setEditorTextSegmentsWithDecorator(
      ["Existing title ", " /t"],
      1,
      3,
      0,
      "/subagent foreground research ",
    );
    const onSearchEntities = vi.fn().mockResolvedValue([]);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
        onSearchEntities={onSearchEntities}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(screen.getByTestId("slash-command-popup")).toBeInTheDocument();

    await act(async () => {
      expect(hoistedMocks.dispatchTabCommand()).toBe(true);
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(hoistedMocks.textSegments).toEqual(["Existing title ", " /task "]);
    expect(screen.getByTestId("slash-entity-search-popup")).toBeInTheDocument();
    expect(screen.getByTestId("slash-entity-search-query")).toHaveTextContent(
      "",
    );
    expect(hoistedMocks.lastSearchPopupProps?.searchScope).toEqual({
      kind: "work-item-types",
      taskTypes: ["TASK"],
    });
  });

  it("uses Tab to pick an exact command even when a longer command shares the prefix", async () => {
    hoistedMocks.setEditorText("/feature", 8);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(
      screen.getByTestId("slash-command-pick-feature"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("slash-command-pick-feature-tree"),
    ).toBeInTheDocument();

    await act(async () => {
      expect(hoistedMocks.dispatchTabCommand()).toBe(true);
    });

    expect(hoistedMocks.textContent).toBe("/feature ");
  });

  it("routes registry-derived Contract lookup through a work-item subtype scope", async () => {
    hoistedMocks.setEditorText("/contract", 9);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
        onSearchEntities={vi.fn().mockResolvedValue([])}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.click(screen.getByTestId("slash-command-pick-contract"));

    expect(hoistedMocks.lastSearchPopupProps?.searchScope).toEqual({
      kind: "work-item-types",
      taskTypes: ["CONTRACT"],
    });
  });

  it("emits a non-inserting resolved View request for a typed command", async () => {
    const onPickerEmit = vi.fn();
    hoistedMocks.setEditorText("/contract", 9);
    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
        onSearchEntities={vi.fn().mockResolvedValue([])}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });
    fireEvent.click(screen.getByTestId("slash-command-pick-contract"));
    fireEvent.click(screen.getByTestId("slash-entity-search-view"));

    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "openEntitySelection",
      target: { kind: "work-item-type", workItemTypeKey: "CONTRACT" },
      replacementRange: {
        nodeKey: "slash-node-1",
        sliceStart: 0,
        cursorOffset: 10,
      },
    });
    expect(hoistedMocks.textContent).toBe("/contract ");
  });

  it("opens View all with Tab, ArrowDown, and Enter", async () => {
    const onPickerEmit = vi.fn();
    hoistedMocks.setEditorText("/contract", 9);
    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
        onSearchEntities={vi.fn().mockResolvedValue([])}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });
    await act(async () => {
      expect(hoistedMocks.dispatchTabCommand()).toBe(true);
    });
    await act(async () => Promise.resolve());

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "ArrowDown" });
    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });

    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "openEntitySelection",
      target: { kind: "work-item-type", workItemTypeKey: "CONTRACT" },
      replacementRange: {
        nodeKey: "slash-node-1",
        sliceStart: 0,
        cursorOffset: 10,
      },
    });
  });

  it("consumes Enter when typed entity arg entry has no selected row", async () => {
    const onPickerEmit = vi.fn();
    hoistedMocks.setEditorText("/contract", 9);
    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
        onSearchEntities={vi.fn().mockResolvedValue([])}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });
    await act(async () => {
      expect(hoistedMocks.dispatchTabCommand()).toBe(true);
    });
    await act(async () => Promise.resolve());

    expect(fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" })).toBe(
      false,
    );
    expect(onPickerEmit).not.toHaveBeenCalled();
    expect(hoistedMocks.textContent).toBe("/contract ");
  });

  it("starts filtered command lists with the first visible row selected for Tab", async () => {
    hoistedMocks.setEditorText("/fea", 4);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(screen.getByTestId("slash-command-pick-feature")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByTestId("slash-command-pick-feature-tree"),
    ).toHaveAttribute("aria-selected", "false");

    await act(async () => {
      expect(hoistedMocks.dispatchTabCommand()).toBe(true);
    });

    expect(hoistedMocks.textContent).toBe("/feature ");
  });

  it("moves directly from the initial command row to the next filtered row", async () => {
    const onPickerEmit = vi.fn();
    hoistedMocks.setEditorText("/fea", 4);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "ArrowDown" });

    expect(screen.getByTestId("slash-command-pick-feature")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(
      screen.getByTestId("slash-command-pick-feature-tree"),
    ).toHaveAttribute("aria-selected", "true");

    await act(async () => {
      expect(hoistedMocks.dispatchTabCommand()).toBe(true);
    });

    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "openPicker",
      picker: FEATURE_TREE_PICKER,
      replacementRange: {
        nodeKey: "slash-node-1",
        sliceStart: 0,
        cursorOffset: 4,
      },
      anchorPosition: {
        top: 70,
        left: 32,
      },
    });
    expect(hoistedMocks.textContent).toBe("/fea");
  });

  it("keeps the stricter start-or-whitespace trigger for general slash commands", async () => {
    hoistedMocks.setEditorText("prefix/", 7);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(screen.queryByTestId("slash-command-popup")).toBeNull();
  });

  it("does not intercept paste while the picker is only browsing commands", async () => {
    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(screen.getByTestId("slash-command-mode")).toHaveTextContent(
      "command-pick",
    );

    await act(async () => {
      expect(hoistedMocks.dispatchPasteCommand("\n billing \n")).toBe(false);
    });

    expect(hoistedMocks.textContent).toBe("/search");
    expect(screen.getByTestId("slash-command-query")).toHaveTextContent(
      "search",
    );
  });

  it("trims pasted text before committing slash-command arguments", async () => {
    const onPickerEmit = vi.fn();

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("slash-command-pick-search"));
    });

    expect(screen.getByTestId("slash-command-mode")).toHaveTextContent(
      "arg-entry-query",
    );

    await act(async () => {
      expect(hoistedMocks.dispatchPasteCommand("\n  billing\n")).toBe(true);
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(screen.getByTestId("slash-command-query")).toHaveTextContent(
      "billing",
    );

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });

    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "openModal",
      modal: "search",
      prefill: "billing",
    });
  });

  it("emits a feature-tree picker launch without replacing the typed command text", async () => {
    const onPickerEmit = vi.fn();
    hoistedMocks.setEditorText("/feature-tree", 13);

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.click(screen.getByTestId("slash-command-pick-feature-tree"));

    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "openPicker",
      picker: FEATURE_TREE_PICKER,
      replacementRange: {
        nodeKey: "slash-node-1",
        sliceStart: 0,
        cursorOffset: 13,
      },
      anchorPosition: {
        top: 70,
        left: 32,
      },
    });
  });

  it("keeps /search inline when inline search mode is enabled", async () => {
    const onPickerEmit = vi.fn();
    const onInlineSearch = vi.fn();

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
        onSearchEntities={vi.fn().mockResolvedValue([])}
        onInlineSearch={onInlineSearch}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.click(screen.getByTestId("slash-command-pick-search"));

    await act(async () => {
      hoistedMocks.setEditorText("/search billing", 15);
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });

    expect(onInlineSearch).toHaveBeenCalledWith("billing");
    expect(screen.getByTestId("slash-entity-search-popup")).toBeInTheDocument();
    expect(screen.getByTestId("slash-entity-search-query")).toHaveTextContent(
      "billing",
    );
    expect(hoistedMocks.lastSearchPopupProps?.searchScope).toEqual({
      kind: "entity-types",
      entityTypes: [
        "task",
        "workflow",
        "initiative",
        "design_doc",
        "project",
        "service",
        "conversation",
        "agent_session",
      ],
    });
    expect(onPickerEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "openModal" }),
    );

    fireEvent.click(screen.getByTestId("slash-entity-search-select"));

    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "insertMention",
      entityRef: {
        entityType: "task",
        entityId: "task-1",
        entityName: "Task One",
      },
      replacementRange: {
        nodeKey: "slash-node-1",
        sliceStart: 0,
        cursorOffset: 0,
      },
    });
  });

  it.each(["mockups_v2", "CONTRACT", "mockups_v3"])(
    "inserts the exact %s registry key for a picked work item",
    async (taskType) => {
      const onPickerEmit = vi.fn();

      render(
        <SlashCommandPlugin
          organizationId="org-1"
          projectId="project-1"
          surfaceContext={{
            focalEntity: { kind: "none" },
            cachedConversationMentionOptions: [],
          }}
          onPickerEmit={onPickerEmit}
          onSearchEntities={vi.fn().mockResolvedValue([])}
          onInlineSearch={vi.fn()}
        />,
      );

      await act(async () => {
        hoistedMocks.updateListeners.forEach((listener) => listener());
      });

      fireEvent.click(screen.getByTestId("slash-command-pick-search"));

      await act(async () => {
        hoistedMocks.setEditorText("/search billing", 15);
        hoistedMocks.updateListeners.forEach((listener) => listener());
      });

      fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });

      act(() => {
        hoistedMocks.lastSearchPopupProps?.onSelectEntity({
          id: "item-1",
          type: "task",
          name: "Item One",
          metadata: { taskType },
        });
      });

      expect(onPickerEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "insertMention",
          entityRef: {
            entityType: taskType,
            entityId: "item-1",
            entityName: "Item One",
          },
        }),
      );
    },
  );

  it("blocks Enter from committing slash entity search rows while they are stale", async () => {
    const onPickerEmit = vi.fn();

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
        onSearchEntities={vi.fn().mockResolvedValue([])}
        onInlineSearch={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.click(screen.getByTestId("slash-command-pick-search"));

    await act(async () => {
      hoistedMocks.setEditorText("/search billing", 15);
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });
    expect(screen.getByTestId("slash-entity-search-popup")).toBeInTheDocument();

    await act(async () => {
      hoistedMocks.lastSearchPopupProps?.onResultsChange(
        [hoistedMocks.searchResult],
        "stale-while-updating",
      );
    });

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });

    expect(onPickerEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "insertMention" }),
    );

    await act(async () => {
      hoistedMocks.lastSearchPopupProps?.onResultsChange(
        [hoistedMocks.searchResult],
        "settled",
      );
    });

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });

    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "insertMention",
      entityRef: {
        entityType: "task",
        entityId: "task-1",
        entityName: "Task One",
      },
      replacementRange: {
        nodeKey: "slash-node-1",
        sliceStart: 0,
        cursorOffset: 0,
      },
    });
  });

  it("dismisses inline search when the caret moves away from the replacement point", async () => {
    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={vi.fn()}
        onSearchEntities={vi.fn().mockResolvedValue([])}
        onInlineSearch={vi.fn()}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.click(screen.getByTestId("slash-command-pick-search"));

    await act(async () => {
      hoistedMocks.setEditorText("/search billing", 15);
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });
    expect(screen.getByTestId("slash-entity-search-popup")).toBeInTheDocument();

    await act(async () => {
      hoistedMocks.setEditorText("draft text", 5);
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    expect(screen.queryByTestId("slash-entity-search-popup")).toBeNull();
  });

  it("falls back to the modal flow when inline search has no entity search backend", async () => {
    const onPickerEmit = vi.fn();
    const onInlineSearch = vi.fn();

    render(
      <SlashCommandPlugin
        organizationId="org-1"
        projectId="project-1"
        surfaceContext={{
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        }}
        onPickerEmit={onPickerEmit}
        onInlineSearch={onInlineSearch}
      />,
    );

    await act(async () => {
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.click(screen.getByTestId("slash-command-pick-search"));

    await act(async () => {
      hoistedMocks.setEditorText("/search billing", 15);
      hoistedMocks.updateListeners.forEach((listener) => listener());
    });

    fireEvent.keyDown(hoistedMocks.rootElement, { key: "Enter" });

    expect(onInlineSearch).not.toHaveBeenCalled();
    expect(onPickerEmit).toHaveBeenCalledWith({
      type: "openModal",
      modal: "search",
      prefill: "billing",
    });
    expect(screen.queryByTestId("slash-entity-search-popup")).toBeNull();
  });
});
