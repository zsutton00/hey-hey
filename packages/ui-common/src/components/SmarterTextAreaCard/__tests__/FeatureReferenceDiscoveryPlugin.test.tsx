import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import {
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $getRoot,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  PASTE_COMMAND,
  SKIP_SELECTION_FOCUS_TAG,
  UNDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemReferencesState } from "../../../data/hooks/useWorkItemReferences";
import { FeatureReferenceDiscoveryPlugin } from "../FeatureReferenceDiscoveryPlugin";
import {
  didInsertFeatureReferenceCompletionBoundary,
  FEATURE_REFERENCE_DISCOVERY_TAG,
} from "../featureReferenceDiscovery";
import { FeatureReferenceMatchNode } from "../FeatureReferenceMatchNode";
import { MentionNode } from "../MentionNode";
import { setExplicitCommandInteractionActive } from "../explicitCommandActivity";
import { serializeEditorState } from "../serializationUtils";

const recentSelectionMocks = vi.hoisted(() => ({
  record: vi.fn(),
}));

const readyState = {
  status: "ready" as const,
  references: [
    {
      id: "feature-search",
      name: "Feature Search",
      type: "FEATURE",
      parentTaskId: null,
    },
  ],
  isFetching: false as const,
};

let referencesState: WorkItemReferencesState = readyState;
let servicesState = {
  services: [] as Array<{
    id: string;
    name: string;
    organizationId: string;
    projectId?: string;
  }>,
  isReady: true,
};
let testEditor: LexicalEditor | null = null;
let detectorUpdateTags: Set<string>[] = [];
let detectorTagObserverReady = false;

vi.mock("../../../data/hooks/useWorkItemReferences", () => ({
  useWorkItemReferences: () => referencesState,
}));

vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => servicesState,
}));

vi.mock("../recentMentionSelections", () => ({
  useRecentMentionSelections: () => ({
    selections: [],
    record: recentSelectionMocks.record,
  }),
}));

vi.mock("../MentionBadge", () => ({
  MentionBadgeInner: () => <span data-testid="mention-badge" />,
}));

function EditorControls() {
  const [editor] = useLexicalComposerContext();
  testEditor = editor;

  const setText = (text: string) => {
    editor.update(
      () => {
        const textNode = $createTextNode(text);
        $getRoot().clear().append($createParagraphNode().append(textNode));
        textNode.selectEnd();
      },
      { discrete: true, tag: HISTORY_PUSH_TAG }
    );
  };

  const appendText = (text: string) => {
    editor.update(
      () => {
        const textNode = $getRoot().getAllTextNodes().at(-1);
        if (!$isTextNode(textNode)) return;
        textNode.setTextContent(`${textNode.getTextContent()}${text}`);
        textNode.selectEnd();
      },
      { discrete: true, tag: HISTORY_PUSH_TAG }
    );
  };

  const typeAtSelection = (text: string) => {
    editor.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        selection.insertText(text);
      },
      { discrete: true, tag: HISTORY_PUSH_TAG }
    );
  };

  const pasteText = (text: string) => {
    editor.update(
      () => {
        const textNode = $createTextNode("paste target");
        $getRoot().clear().append($createParagraphNode().append(textNode));
        textNode.select(0, textNode.getTextContentSize());
      },
      { discrete: true, tag: HISTORY_PUSH_TAG }
    );
    const event = new ClipboardEvent("paste");
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        types: ["text/plain"],
        getData: (format: string) => (format === "text/plain" ? text : ""),
      },
    });
    editor.dispatchCommand(PASTE_COMMAND, event);
  };

  const editMatch = () => {
    editor.update(
      () => {
        $setSelection(null);
        const textNode = $getRoot().getAllTextNodes()[0];
        if (!$isTextNode(textNode)) return;
        textNode.setTextContent("Feature Searchable");
      },
      { discrete: true }
    );
  };

  const editCurrentMatch = () => {
    editor.update(
      () => {
        const matchNode = $getRoot()
          .getAllTextNodes()
          .find((node) => node.getType() === "feature-reference-match");
        matchNode?.setTextContent(`${matchNode.getTextContent()}s`);
      },
      { discrete: true }
    );
  };

  const selectTitle = () => {
    editor.update(
      () => {
        $getRoot().getFirstDescendant()?.selectEnd();
      },
      { discrete: true }
    );
  };

  return (
    <>
      <button
        data-testid="set-title"
        onClick={() => setText("Feature Search")}
      />
      <button data-testid="set-service" onClick={() => setText("UI Common")} />
      <button
        data-testid="set-shared-workspace"
        onClick={() => setText("Shared Workspace")}
      />
      <button
        data-testid="set-search-agent"
        onClick={() => setText("Search Ag")}
      />
      <button
        data-testid="set-bare-at-search-agent"
        onClick={() => setText("@Search Ag")}
      />
      <button
        data-testid="set-ui-cli-communications"
        onClick={() => setText("ui-cli communications")}
      />
      <button
        data-testid="set-conversation"
        onClick={() => setText("Conversation")}
      />
      <button
        data-testid="set-conv-viewer"
        onClick={() => setText("conv viewer ")}
      />
      <button
        data-testid="set-two-references"
        onClick={() => setText("Roadmap Alpha")}
      />
      <button data-testid="set-ui-cli" onClick={() => setText("ui-cli")} />
      <button
        data-testid="append-communications"
        onClick={() => appendText("communications")}
      />
      <button data-testid="append-space" onClick={() => appendText(" ")} />
      <button
        data-testid="append-viewer"
        onClick={() => appendText("Viewer")}
      />
      <button data-testid="append-comma" onClick={() => appendText(",")} />
      <button
        data-testid="type-at-selection"
        onClick={() => typeAtSelection("continued")}
      />
      <button
        data-testid="paste-at-threshold"
        onClick={() => pasteText(`${" ".repeat(1_985)}Feature Search `)}
      />
      <button
        data-testid="paste-over-threshold"
        onClick={() => pasteText(`${" ".repeat(1_986)}Feature Search `)}
      />
      <button
        data-testid="append-roadmap"
        onClick={() => appendText("Roadmap")}
      />
      <button
        data-testid="set-roadmap"
        onClick={() => setText("See Roadmap")}
      />
      <button data-testid="edit-match" onClick={editMatch} />
      <button data-testid="edit-current-match" onClick={editCurrentMatch} />
      <button data-testid="select-title" onClick={selectTitle} />
      <button
        data-testid="clear-selection"
        onClick={() =>
          editor.update(() => $setSelection(null), { discrete: true })
        }
      />
      <button
        data-testid="undo"
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
      />
      <button
        data-testid="start-explicit-command"
        onClick={() =>
          setExplicitCommandInteractionActive(editor, "slash-command", true)
        }
      />
      <button
        data-testid="stop-explicit-command"
        onClick={() =>
          setExplicitCommandInteractionActive(editor, "slash-command", false)
        }
      />
    </>
  );
}

function DetectorTagObserver() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    detectorTagObserverReady = true;
    const unregister = editor.registerUpdateListener(({ tags }) => {
      if (tags.has(FEATURE_REFERENCE_DISCOVERY_TAG)) {
        detectorUpdateTags.push(new Set(tags));
      }
    });
    return () => {
      detectorTagObserverReady = false;
      unregister();
    };
  }, [editor]);

  return null;
}

function PluginTestSurface() {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "FeatureReferenceDiscoveryPluginTest",
        nodes: [FeatureReferenceMatchNode, MentionNode],
        onError: (error) => {
          throw error;
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable data-testid="editor" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <FeatureReferenceDiscoveryPlugin
        organizationId="org-1"
        projectId="project-1"
      />
      <HistoryPlugin />
      <DetectorTagObserver />
      <EditorControls />
    </LexicalComposer>
  );
}

const renderPlugin = () => {
  detectorUpdateTags = [];
  detectorTagObserverReady = false;
  return render(<PluginTestSurface />);
};

function readEditorText(): string {
  let text = "";
  testEditor?.getEditorState().read(() => {
    text = $getRoot().getTextContent();
  });
  return text;
}

function readSerializedEditorText(): string {
  let text = "";
  testEditor?.getEditorState().read(() => {
    text = serializeEditorState();
  });
  return text;
}

function readTextNodeState(): Array<{
  style: string;
  text: string;
  type: string;
}> {
  let state: Array<{ style: string; text: string; type: string }> = [];
  testEditor?.getEditorState().read(() => {
    state = $getRoot()
      .getAllTextNodes()
      .map((node) => ({
        style: node.getStyle(),
        text: node.getTextContent(),
        type: node.getType(),
      }));
  });
  return state;
}

function readSelectionState(): {
  anchorOffset: number;
  anchorText: string;
  anchorType: string;
} | null {
  let selection: {
    anchorOffset: number;
    anchorText: string;
    anchorType: string;
  } | null = null;
  testEditor?.getEditorState().read(() => {
    const currentSelection = $getSelection();
    if (!$isRangeSelection(currentSelection)) return;

    const anchorNode = currentSelection.anchor.getNode();
    selection = {
      anchorOffset: currentSelection.anchor.offset,
      anchorText: anchorNode.getTextContent(),
      anchorType: anchorNode.getType(),
    };
  });
  return selection;
}

describe("FeatureReferenceDiscoveryPlugin", () => {
  beforeEach(() => {
    vi.stubGlobal("DragEvent", class DragEvent extends Event {});
    vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {});
    servicesState = { services: [], isReady: true };
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(),
    });
    recentSelectionMocks.record.mockClear();
  });
  it("recognizes whitespace and punctuation insertions as completion boundaries", () => {
    expect(
      didInsertFeatureReferenceCompletionBoundary(
        "Feature Search",
        "Feature Search "
      )
    ).toBe(true);
    expect(
      didInsertFeatureReferenceCompletionBoundary(
        "Feature Search",
        "Feature Search,"
      )
    ).toBe(true);
    expect(
      didInsertFeatureReferenceCompletionBoundary(
        "Feature Searc",
        "Feature Search"
      )
    ).toBe(false);
  });

  it("waits for a completion boundary, underlines once, and unwraps edited text", async () => {
    referencesState = readyState;
    renderPlugin();

    await waitFor(() => expect(detectorTagObserverReady).toBe(true));

    fireEvent.click(screen.getByTestId("set-title"));
    expect(
      screen
        .getByTestId("editor")
        .querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);

    fireEvent.click(screen.getByTestId("append-space"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );
    expect(readEditorText()).toBe("Feature Search ");
    expect(readTextNodeState()).toEqual([
      expect.objectContaining({
        text: "Feature Search",
        type: "feature-reference-match",
      }),
      expect.objectContaining({ text: " ", type: "text" }),
    ]);
    expect(readSelectionState()).toEqual({
      anchorOffset: 1,
      anchorText: " ",
      anchorType: "text",
    });
    expect(detectorUpdateTags.length).toBeGreaterThan(0);
    expect(detectorUpdateTags.at(-1)?.has(HISTORY_MERGE_TAG)).toBe(true);
    expect(detectorUpdateTags.at(-1)?.has(SKIP_SELECTION_FOCUS_TAG)).toBe(true);

    fireEvent.click(screen.getByTestId("edit-match"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(0)
    );
    expect(readEditorText()).toBe("Feature Searchable ");
  });

  it("discovers references in a paste of exactly 2,000 characters", async () => {
    referencesState = readyState;
    renderPlugin();

    fireEvent.click(screen.getByTestId("paste-at-threshold"));

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );
    expect(readEditorText()).toHaveLength(2_000);
  });

  it("skips only an oversized paste and resumes discovery for later typing", async () => {
    referencesState = readyState;
    renderPlugin();

    fireEvent.click(screen.getByTestId("paste-over-threshold"));

    await waitFor(() => expect(readEditorText()).toHaveLength(2_001));
    expect(
      screen
        .getByTestId("editor")
        .querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);

    fireEvent.click(screen.getByTestId("select-title"));
    await Promise.resolve();
    expect(
      screen
        .getByTestId("editor")
        .querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);

    fireEvent.click(screen.getByTestId("type-at-selection"));
    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );
  });

  it("discovers an active project service and commits its canonical typed mention", async () => {
    referencesState = {
      status: "loading",
      references: [],
      isFetching: true,
    };
    servicesState = {
      isReady: true,
      services: [
        {
          id: "service-ui-common",
          name: "UI Common",
          organizationId: "org-1",
          projectId: "project-1",
        },
      ],
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-service"));
    fireEvent.click(screen.getByTestId("append-space"));
    const match = await screen.findByTestId("feature-reference-match");
    expect(readSerializedEditorText()).toBe("UI Common ");

    fireEvent.click(match);
    const candidate = await screen.findByTestId("feature-reference-candidate");
    expect(candidate).toHaveAttribute("data-entity-type", "service");
    expect(candidate).toHaveAttribute("data-entity-id", "service-ui-common");
    fireEvent.click(candidate);

    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "@[service:service-ui-common|UI Common] "
      )
    );
    expect(recentSelectionMocks.record).toHaveBeenCalledWith({
      id: "service-ui-common",
      type: "service",
      name: "UI Common",
    });
  });

  it("keeps a service candidate selectable across an equivalent collection refresh", async () => {
    referencesState = {
      status: "loading",
      references: [],
      isFetching: true,
    };
    servicesState = {
      isReady: true,
      services: [
        {
          id: "service-workspace",
          name: "Shared Workspace",
          organizationId: "org-1",
          projectId: "project-1",
        },
      ],
    };
    const rendered = renderPlugin();

    fireEvent.click(screen.getByTestId("set-shared-workspace"));
    fireEvent.click(screen.getByTestId("append-space"));
    const match = await screen.findByTestId("feature-reference-match");
    fireEvent.click(match);
    await screen.findByTestId("feature-reference-candidate");

    servicesState = {
      ...servicesState,
      services: servicesState.services.map((service) => ({ ...service })),
    };
    rendered.rerender(<PluginTestSurface />);

    fireEvent.click(await screen.findByTestId("feature-reference-candidate"));
    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "@[service:service-workspace|Shared Workspace] "
      )
    );
  });

  it("discovers a fuzzy title at a boundary and converts it canonically", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-search-agent",
          name: "Search Agent",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();
    vi.spyOn(testEditor!, "focus").mockImplementation(() => undefined);

    fireEvent.click(screen.getByTestId("set-search-agent"));
    expect(
      screen
        .getByTestId("editor")
        .querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);

    fireEvent.click(screen.getByTestId("append-space"));
    const match = await screen.findByTestId("feature-reference-match");
    expect(match).toHaveTextContent("Search Ag");
    expect(readSerializedEditorText()).toBe("Search Ag ");

    fireEvent.click(match);
    fireEvent.click(await screen.findByTestId("feature-reference-candidate"));

    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "@[feature:feature-search-agent|Search Agent] "
      )
    );
    expect(recentSelectionMocks.record).toHaveBeenCalledTimes(1);
  });

  it("does not discover literal bare-at input", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-search-agent",
          name: "Search Agent",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-bare-at-search-agent"));
    fireEvent.click(screen.getByTestId("append-space"));

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(0)
    );
    expect(readSerializedEditorText()).toBe("@Search Ag ");
  });

  it("matches a completed punctuation-separated title", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-ui-cli-communications",
          name: "UI-CLI Communications",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-ui-cli-communications"));
    expect(
      screen
        .getByTestId("editor")
        .querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);

    fireEvent.click(screen.getByTestId("append-space"));

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );
    expect(readSerializedEditorText()).toBe("ui-cli communications ");
  });

  it("waits for the complete title instead of freezing a punctuation prefix", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-ui-cli-communications",
          name: "UI-CLI Communications",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-ui-cli"));
    fireEvent.click(screen.getByTestId("append-space"));
    expect(
      screen
        .getByTestId("editor")
        .querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);

    fireEvent.click(screen.getByTestId("append-communications"));
    expect(
      screen
        .getByTestId("editor")
        .querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);

    fireEvent.click(screen.getByTestId("append-space"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );
  });

  it("rejects a stale fuzzy selection after the matched phrase is edited", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-search-agent",
          name: "Search Agent",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();
    vi.spyOn(testEditor!, "focus").mockImplementation(() => undefined);

    fireEvent.click(screen.getByTestId("set-search-agent"));
    fireEvent.click(screen.getByTestId("append-space"));
    fireEvent.click(await screen.findByTestId("feature-reference-match"));
    const staleOption = await screen.findByTestId(
      "feature-reference-candidate"
    );

    fireEvent.click(screen.getByTestId("edit-current-match"));
    fireEvent.click(staleOption);

    await waitFor(() =>
      expect(
        screen.queryByTestId("feature-reference-candidate-popup")
      ).toBeNull()
    );
    expect(readSerializedEditorText()).toBe("Search Ags ");
    expect(recentSelectionMocks.record).not.toHaveBeenCalled();
  });

  it("keeps the caret after a discovered phrase for continued typing", async () => {
    referencesState = readyState;
    renderPlugin();

    await waitFor(() => expect(detectorTagObserverReady).toBe(true));
    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );

    expect(readSelectionState()).toEqual({
      anchorOffset: 1,
      anchorText: " ",
      anchorType: "text",
    });

    fireEvent.click(screen.getByTestId("type-at-selection"));

    await waitFor(() =>
      expect(readEditorText()).toBe("Feature Search continued")
    );
  });

  it("discovers and converts a second feature after the first mention is committed", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-search",
          name: "Feature Search",
          type: "FEATURE",
          parentTaskId: null,
        },
        {
          id: "feature-roadmap",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();
    vi.spyOn(testEditor!, "focus").mockImplementation(() => undefined);

    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));
    fireEvent.click(await screen.findByTestId("feature-reference-match"));
    fireEvent.click(await screen.findByTestId("feature-reference-candidate"));

    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "@[feature:feature-search|Feature Search] "
      )
    );
    fireEvent.click(screen.getByTestId("append-roadmap"));
    fireEvent.click(screen.getByTestId("append-space"));

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );

    fireEvent.click(screen.getByTestId("feature-reference-match"));
    fireEvent.click(await screen.findByTestId("feature-reference-candidate"));

    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "@[feature:feature-search|Feature Search] @[feature:feature-roadmap|Roadmap] "
      )
    );
  });

  it("ignores selection-only updates", async () => {
    referencesState = readyState;
    renderPlugin();
    await waitFor(() => expect(detectorTagObserverReady).toBe(true));

    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("select-title"));

    expect(
      screen
        .getByTestId("editor")
        .querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);
    expect(readEditorText()).toBe("Feature Search");
  });

  it("does not add a detector-only undo step", async () => {
    referencesState = readyState;
    renderPlugin();
    await waitFor(() => expect(detectorTagObserverReady).toBe(true));
    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );

    fireEvent.click(screen.getByTestId("undo"));
    await waitFor(() => expect(readEditorText()).not.toBe("Feature Search "));
  });

  it("does not detect while the editor is composing", async () => {
    referencesState = readyState;
    renderPlugin();
    const composingSpy = vi
      .spyOn(testEditor!, "isComposing")
      .mockReturnValue(true);

    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(0)
    );
    composingSpy.mockRestore();
  });

  it("pauses while an explicit command interaction is active", async () => {
    referencesState = readyState;
    renderPlugin();

    fireEvent.click(screen.getByTestId("start-explicit-command"));
    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(0)
    );
    fireEvent.click(screen.getByTestId("stop-explicit-command"));
  });

  it("unwraps current matches when references become unavailable", async () => {
    referencesState = readyState;
    const rendered = renderPlugin();
    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));
    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );

    referencesState = {
      status: "loading",
      references: [],
      isFetching: true,
    };
    rendered.rerender(<PluginTestSurface />);

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(0)
    );
    expect(readEditorText()).toBe("Feature Search ");
  });

  it("opens an anchored accessible list and disambiguates duplicate titles", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-alpha",
          name: "Alpha",
          type: "FEATURE",
          parentTaskId: null,
        },
        {
          id: "feature-beta",
          name: "Beta",
          type: "FEATURE",
          parentTaskId: null,
        },
        {
          id: "feature-roadmap-alpha",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: "feature-alpha",
        },
        {
          id: "feature-roadmap-beta",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: "feature-beta",
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-roadmap"));
    fireEvent.click(screen.getByTestId("append-comma"));
    const match = await screen.findByTestId("feature-reference-match");

    expect(match).toHaveAttribute("role", "button");
    expect(match).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(match, { key: "Enter" });

    expect(
      await screen.findByTestId("feature-reference-candidate-popup")
    ).toBeVisible();
    const options = screen.getAllByTestId("feature-reference-candidate");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Roadmap");
    expect(options[0]).toHaveTextContent("Alpha");
    expect(options[1]).toHaveTextContent("Roadmap");
    expect(options[1]).toHaveTextContent("Beta");
  });

  it("moves focus to passive matches beside the caret and between matches without opening or converting", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-roadmap",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: null,
        },
        {
          id: "feature-alpha",
          name: "Alpha",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-two-references"));
    fireEvent.click(screen.getByTestId("append-comma"));
    const matches = await screen.findAllByTestId("feature-reference-match");
    const rootElement = testEditor!.getRootElement()!;
    const pressTab = (target: HTMLElement, shiftKey = false): boolean =>
      fireEvent.keyDown(target, { key: "Tab", shiftKey });

    const placeCaret = (atEnd: boolean): void => {
      const range = document.createRange();
      range.selectNodeContents(rootElement);
      range.collapse(!atEnd);
      document.getSelection()!.removeAllRanges();
      document.getSelection()!.addRange(range);
    };

    placeCaret(true);
    expect(pressTab(rootElement)).toBe(true);
    expect(pressTab(rootElement, true)).toBe(false);
    expect(matches[1]).toHaveFocus();

    placeCaret(false);
    expect(pressTab(rootElement, true)).toBe(true);
    expect(pressTab(rootElement)).toBe(false);
    expect(matches[0]).toHaveFocus();
    expect(pressTab(matches[0]!)).toBe(false);
    expect(matches[1]).toHaveFocus();
    expect(pressTab(matches[1]!, true)).toBe(false);
    expect(matches[0]).toHaveFocus();
    expect(pressTab(matches[1]!)).toBe(true);
    expect(pressTab(matches[0]!, true)).toBe(true);

    expect(
      screen.queryByTestId("feature-reference-candidate-popup")
    ).not.toBeInTheDocument();
    for (const match of matches) {
      expect(match).not.toHaveAttribute("aria-expanded", "true");
    }
    expect(readSerializedEditorText()).toBe("Roadmap Alpha,");
  });

  it("does not convert the selected candidate on Tab while the list is open", async () => {
    referencesState = readyState;
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));
    fireEvent.click(await screen.findByTestId("feature-reference-match"));
    const listbox = await screen.findByRole("listbox");

    fireEvent.keyDown(listbox, { key: "Tab" });
    fireEvent.keyDown(listbox, { key: "Tab", shiftKey: true });

    expect(readSerializedEditorText()).toBe("Feature Search ");
    expect(recentSelectionMocks.record).not.toHaveBeenCalled();
  });

  it("leaves Tab available to an engaged slash command", async () => {
    referencesState = readyState;
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-title"));
    fireEvent.click(screen.getByTestId("append-space"));
    const match = await screen.findByTestId("feature-reference-match");

    fireEvent.click(screen.getByTestId("start-explicit-command"));
    expect(
      fireEvent.keyDown(testEditor!.getRootElement()!, { key: "Tab" })
    ).toBe(true);
    expect(match).not.toHaveFocus();

    expect(match).not.toHaveAttribute("aria-expanded", "true");
    expect(readSerializedEditorText()).toBe("Feature Search ");
    fireEvent.click(screen.getByTestId("stop-explicit-command"));
  });

  it("leaves Tab unhandled when there are no passive matches", () => {
    referencesState = readyState;
    renderPlugin();

    expect(
      fireEvent.keyDown(testEditor!.getRootElement()!, { key: "Tab" })
    ).toBe(true);
  });

  it("commits a single keyboard candidate with the first Enter press", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-roadmap",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-roadmap"));
    fireEvent.click(screen.getByTestId("append-comma"));
    const match = await screen.findByTestId("feature-reference-match");
    match.focus();
    fireEvent.keyDown(match, { key: "Enter" });

    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "See @[feature:feature-roadmap|Roadmap],"
      )
    );
    expect(
      screen.queryByTestId("feature-reference-candidate-popup")
    ).toBeNull();
  });

  it("continues keyboard traversal at the next discovered phrase", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-roadmap",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: null,
        },
        {
          id: "feature-alpha",
          name: "Alpha",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-two-references"));
    fireEvent.click(screen.getByTestId("append-comma"));
    const matches = await screen.findAllByTestId("feature-reference-match");
    expect(matches).toHaveLength(2);
    matches[0]!.focus();
    fireEvent.keyDown(matches[0]!, { key: "Enter" });

    await waitFor(() => expect(matches[1]).toHaveFocus());
  });

  it("upgrades an earlier exact phrase when a longer exact title is completed", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-conversation",
          name: "Conversation",
          type: "FEATURE",
          parentTaskId: null,
        },
        {
          id: "feature-conversation-viewer",
          name: "Conversation Viewer",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-conversation"));
    fireEvent.click(screen.getByTestId("append-space"));
    expect(
      await screen.findByTestId("feature-reference-match")
    ).toHaveTextContent("Conversation");

    fireEvent.click(screen.getByTestId("append-viewer"));
    fireEvent.click(screen.getByTestId("append-space"));

    await waitFor(() =>
      expect(screen.getByTestId("feature-reference-match")).toHaveTextContent(
        "Conversation Viewer"
      )
    );
    fireEvent.keyDown(screen.getByTestId("feature-reference-match"), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "@[feature:feature-conversation-viewer|Conversation Viewer] "
      )
    );
  });

  it("discovers and converts the bounded conv viewer shorthand", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-conversation-viewer",
          name: "Conversation Viewer",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();

    fireEvent.click(screen.getByTestId("set-conv-viewer"));
    const match = await screen.findByTestId("feature-reference-match");
    expect(match).toHaveTextContent("conv viewer");
    expect(readSerializedEditorText()).toBe("conv viewer ");

    fireEvent.keyDown(match, { key: "Enter" });

    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "@[feature:feature-conversation-viewer|Conversation Viewer] "
      )
    );
  });

  it("uses the same deterministic order for keyboard commit and preserves punctuation", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-alpha",
          name: "Alpha",
          type: "FEATURE",
          parentTaskId: null,
        },
        {
          id: "feature-beta",
          name: "Beta",
          type: "FEATURE",
          parentTaskId: null,
        },
        {
          id: "feature-roadmap-beta",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: "feature-beta",
        },
        {
          id: "feature-roadmap-alpha",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: "feature-alpha",
        },
      ],
      isFetching: false,
    };
    renderPlugin();
    const focusSpy = vi
      .spyOn(testEditor!, "focus")
      .mockImplementation(() => undefined);

    fireEvent.click(screen.getByTestId("set-roadmap"));
    fireEvent.click(screen.getByTestId("append-comma"));
    fireEvent.keyDown(await screen.findByTestId("feature-reference-match"), {
      key: "Enter",
    });

    await screen.findByRole("listbox");
    const options = screen.getAllByTestId("feature-reference-candidate");
    expect(options[0]).toHaveTextContent("Alpha");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(options[0]).toHaveFocus());

    fireEvent.keyDown(options[0], { key: "ArrowDown" });
    await waitFor(() => {
      expect(options[1]).toHaveAttribute("aria-selected", "true");
      expect(options[1]).toHaveFocus();
    });
    fireEvent.keyDown(options[1], { key: "Enter" });

    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "See @[feature:feature-roadmap-beta|Roadmap],"
      )
    );
    expect(recentSelectionMocks.record).toHaveBeenCalledTimes(1);
    expect(recentSelectionMocks.record).toHaveBeenCalledWith({
      id: "feature-roadmap-beta",
      type: "feature",
      name: "Roadmap",
    });
    await waitFor(() => expect(focusSpy).toHaveBeenCalledTimes(1));
  });

  it("commits pointer selection once and dismisses Escape without mutation", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-roadmap",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();
    vi.spyOn(testEditor!, "focus").mockImplementation(() => undefined);

    fireEvent.click(screen.getByTestId("set-roadmap"));
    fireEvent.click(screen.getByTestId("append-comma"));
    fireEvent.click(await screen.findByTestId("feature-reference-match"));
    fireEvent.keyDown(await screen.findByRole("listbox"), { key: "Escape" });

    expect(
      screen.queryByTestId("feature-reference-candidate-popup")
    ).toBeNull();
    expect(readSerializedEditorText()).toBe("See Roadmap,");
    expect(recentSelectionMocks.record).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("feature-reference-match"));
    await screen.findByRole("listbox");
    fireEvent.click(document.body);
    expect(
      screen.queryByTestId("feature-reference-candidate-popup")
    ).toBeNull();
    expect(readSerializedEditorText()).toBe("See Roadmap,");
    expect(recentSelectionMocks.record).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("feature-reference-match"));
    fireEvent.click(await screen.findByTestId("feature-reference-candidate"));

    await waitFor(() =>
      expect(readSerializedEditorText()).toBe(
        "See @[feature:feature-roadmap|Roadmap],"
      )
    );
    expect(recentSelectionMocks.record).toHaveBeenCalledTimes(1);
  });

  it("rejects a commit after the matched source text changes", async () => {
    referencesState = {
      status: "ready",
      references: [
        {
          id: "feature-roadmap",
          name: "Roadmap",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      isFetching: false,
    };
    renderPlugin();
    vi.spyOn(testEditor!, "focus").mockImplementation(() => undefined);

    fireEvent.click(screen.getByTestId("set-roadmap"));
    fireEvent.click(screen.getByTestId("append-comma"));
    fireEvent.click(await screen.findByTestId("feature-reference-match"));
    const staleOption = await screen.findByTestId(
      "feature-reference-candidate"
    );

    fireEvent.click(screen.getByTestId("edit-current-match"));
    fireEvent.click(staleOption);

    await waitFor(() =>
      expect(
        screen.queryByTestId("feature-reference-candidate-popup")
      ).toBeNull()
    );
    expect(readSerializedEditorText()).toBe("See Roadmaps,");
    expect(recentSelectionMocks.record).not.toHaveBeenCalled();
  });
});
