import { useEffect } from "react";
import userEvent from "@testing-library/user-event";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import {
  $getRoot,
  $isParagraphNode,
  $createParagraphNode,
  $createTextNode,
  $getSelection,
  $setSelection,
  $isRangeSelection,
  KEY_TAB_COMMAND,
  KEY_BACKSPACE_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  type LexicalEditor,
} from "lexical";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SubagentCommandNode,
  $isSubagentCommandNode,
} from "../slashCommands/SubagentCommandNode";
import { SubagentCommandPlugin } from "../slashCommands/SubagentCommandPlugin";
import { $readSubagentEditorState } from "../slashCommands/subagentEditorState";
import {
  loadContentWithMentions,
  serializeEditorState,
} from "../serializationUtils";
import { MentionNode } from "../MentionNode";
import {
  FileReferenceNode,
  $createFileReferenceNode,
} from "../fileReferences/FileReferenceNode";
import { SlashCommandPlugin } from "../slashCommands/SlashCommandPlugin";
import {
  SubagentServicesContext,
  type SubagentServiceScope,
} from "../slashCommands/SubagentServicesContext";

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({ workItemTypes: [] }),
}));
vi.mock("../MentionBadge", () => ({ MentionBadgeInner: () => null }));
vi.mock("../fileReferences/FileReferenceLink", () => ({
  FileReferenceLink: () => null,
}));

beforeEach(() => {
  vi.stubGlobal("DragEvent", class DragEventStub extends Event {});
  vi.stubGlobal(
    "ClipboardEvent",
    class ClipboardEventStub extends Event {
      clipboardData: DataTransfer | null;
      constructor(type: string, init: ClipboardEventInit) {
        super(type, init);
        this.clipboardData = init.clipboardData ?? null;
      }
    }
  );
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 20, 20);
  Range.prototype.getClientRects = () => ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  });
});

let editor: LexicalEditor;
function CaptureEditor() {
  const [instance] = useLexicalComposerContext();
  useEffect(() => {
    editor = instance;
  }, [instance]);
  return null;
}
function setup(
  enabled = true,
  services: SubagentServiceScope = { options: [], sourceServiceIds: [] }
) {
  render(
    <SubagentServicesContext.Provider value={services}>
      <LexicalComposer
        initialConfig={{
          namespace: "subagent-test",
          nodes: [SubagentCommandNode, MentionNode, FileReferenceNode],
          onError: (error) => {
            throw error;
          },
        }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable data-testid="body" />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <CaptureEditor />
        {enabled && <SubagentCommandPlugin />}
        <SlashCommandPlugin
          organizationId={null}
          projectId={null}
          surfaceContext={{
            focalEntity: { kind: "none" },
            cachedConversationMentionOptions: [],
            subagentCommandAvailable: enabled,
            commandSurface: enabled ? undefined : "entity-insertion-only",
          }}
          onPickerEmit={vi.fn()}
        />
        <HistoryPlugin delay={0} />
      </LexicalComposer>
    </SubagentServicesContext.Provider>
  );
}
async function type(text: string) {
  await act(async () =>
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const body = $createTextNode(text);
        $getRoot().clear().append(paragraph.append(body));
        body.selectEnd();
      },
      { discrete: true }
    )
  );
}
function read() {
  return editor.getEditorState().read($readSubagentEditorState);
}

describe("inline subagent command with real Lexical state", () => {
  it("opens from Tab with keyboard focus in the menu and accepts an arrow-key choice", async () => {
    const user = userEvent.setup();
    setup();
    await type("/subagent");
    fireEvent.keyDown(screen.getByTestId("body"), { key: "Tab" });
    const foreground = await screen.findByRole("menuitem", {
      name: "foreground",
    });
    await waitFor(() => expect(foreground).toHaveFocus());
    // Selection-only editor updates must not steal focus back from the menu.
    await act(async () =>
      editor.update(() => $setSelection($getSelection()?.clone() ?? null))
    );
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "background" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    );
    expect(read()).toEqual({
      kind: "empty",
      choices: { mode: "background", capability: "research" },
    });
  });

  it("starts from the source Services and lets the child set be edited down to empty", async () => {
    const user = userEvent.setup();
    setup(true, {
      options: [
        { id: "svc-a", name: "API" },
        { id: "svc-b", name: "UI" },
      ],
      sourceServiceIds: ["svc-a"],
    });
    await type("/subagent ");
    const services = await screen.findByTestId("subagent-command-services");
    expect(services).toHaveTextContent("API");
    expect(screen.queryByText(/launch/i)).not.toBeInTheDocument();

    await user.click(services);
    const [api, ui] = screen.getAllByTestId("subagent-command-service-option");
    await user.click(ui);
    expect(read()).toMatchObject({
      choices: { serviceIds: ["svc-a", "svc-b"] },
    });
    expect(services).toHaveTextContent("2 services");

    await user.click(api);
    await user.click(ui);
    expect(read()).toMatchObject({ choices: { serviceIds: [] } });
    expect(services).toHaveTextContent("No services");
  });

  it("aligns the menu top with the mode button on first open", async () => {
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "subagent-command-mode"
          ? new DOMRect(100, 120, 90, 32)
          : new DOMRect(0, 0, 20, 20);
      });
    try {
      setup();
      await type("/subagent");
      fireEvent.keyDown(screen.getByTestId("body"), { key: "Tab" });
      const menu = await screen.findByRole("menu");
      await waitFor(() =>
        expect(menu.parentElement).toHaveStyle({ top: "120px", left: "100px" })
      );
    } finally {
      bounds.mockRestore();
    }
  });

  it("clicking the empty body puts typing before the non-layout placeholder", async () => {
    setup();
    await type("/subagent ");
    fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });
    const placeholder = screen.getByTestId("subagent-objective-placeholder");
    expect(placeholder).toHaveStyle({ width: "0px", position: "relative" });
    fireEvent.mouseDown(placeholder);
    await act(async () =>
      editor.update(() => {
        const selection = $getSelection();
        expect($isRangeSelection(selection)).toBe(true);
        if ($isRangeSelection(selection)) selection.insertText("Investigate");
      })
    );
    expect(
      screen.queryByTestId("subagent-objective-placeholder")
    ).not.toBeInTheDocument();
    expect(read()).toEqual({
      kind: "ready",
      intent: {
        kind: "subagent",
        mode: "foreground",
        capability: "research",
        objective: "Investigate",
      },
    });
  });
  it("converts typed whitespace, defaults foreground, skips research and moves Tab into the body", async () => {
    setup();
    await type("/subagent ");
    expect(read()).toEqual({
      kind: "empty",
      choices: { mode: "foreground", capability: "research" },
    });
    expect(screen.getByTestId("subagent-command-mode")).toHaveTextContent(
      "foreground"
    );
    await waitFor(() => expect(screen.getByRole("menu")).toBeVisible());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    );
    await act(async () =>
      editor.update(() => {
        const selection = $getSelection();
        expect($isRangeSelection(selection)).toBe(true);
        if ($isRangeSelection(selection)) selection.insertText("Investigate");
      })
    );
    expect(read()).toEqual({
      kind: "ready",
      intent: {
        kind: "subagent",
        mode: "foreground",
        capability: "research",
        objective: "Investigate",
      },
    });
  });

  it("picks the command directly from the popup", async () => {
    setup();
    await type("/subagent");
    const option = await screen.findByText(
      "Choose how a research subagent helps"
    );
    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByTestId("subagent-command-control")).toBeVisible()
    );
    expect(read().kind).toBe("empty");
  });

  it("converts a pasted complete message without consuming the objective", async () => {
    setup();
    await type("");
    fireEvent.paste(screen.getByTestId("body"), {
      clipboardData: {
        types: ["text/plain"],
        files: [],
        getData: (type: string) =>
          type === "text/plain"
            ? "/subagent background research Inspect the API"
            : "",
      },
    });
    await waitFor(() =>
      expect(read()).toEqual({
        kind: "ready",
        intent: {
          kind: "subagent",
          mode: "background",
          capability: "research",
          objective: "Inspect the API",
        },
      })
    );
  });

  it("normalizes leading blank lines while keeping the control first", async () => {
    setup();
    await act(async () =>
      editor.update(
        () =>
          loadContentWithMentions(
            "\n\n \n/subagent background research Inspect"
          ),
        { discrete: true }
      )
    );
    expect(read()).toEqual({
      kind: "ready",
      intent: {
        kind: "subagent",
        mode: "background",
        capability: "research",
        objective: "Inspect",
      },
    });
    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      expect(
        $isParagraphNode(paragraph) &&
          $isSubagentCommandNode(paragraph.getFirstChild())
      ).toBe(true);
    });
  });

  it("keeps message-agent text literal to the subagent control", async () => {
    setup();
    await type("/message-agent ask session Question");
    expect(read().kind).toBe("literal");
    expect(
      screen.queryByTestId("subagent-command-control")
    ).not.toBeInTheDocument();
  });

  it("supports mode choices, Escape, reverse navigation and whole-control reversion", async () => {
    setup();
    await type("/subagent ");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "background" })
    );
    await waitFor(() =>
      expect(screen.getByTestId("subagent-command-mode")).toHaveTextContent(
        "background"
      )
    );
    await act(async () =>
      editor.dispatchCommand(
        KEY_TAB_COMMAND,
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true })
      )
    );
    await waitFor(() => expect(screen.getByRole("menu")).toBeVisible());
    fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });
    expect(read()).toEqual({
      kind: "empty",
      choices: { mode: "background", capability: "research" },
    });
    fireEvent.click(screen.getByTestId("subagent-command-mode"));
    fireEvent.keyDown(
      await screen.findByRole("menuitem", { name: "foreground" }),
      { key: "Enter" }
    );
    await waitFor(() =>
      expect(screen.getByTestId("subagent-command-mode")).toHaveTextContent(
        "foreground"
      )
    );
    fireEvent.keyDown(screen.getByTestId("subagent-command-mode"), {
      key: "Tab",
      shiftKey: true,
    });
    expect(screen.getByTestId("subagent-command-name")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("subagent-command-name"), {
      key: "Backspace",
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("subagent-command-control")
      ).not.toBeInTheDocument()
    );
    expect(editor.getEditorState().read(serializeEditorState)).toBe(
      "/subagent"
    );
  });

  it.each(["foreground", "background"] as const)(
    "restores a %s prefix with canonical references and multiline body",
    async (mode) => {
      setup();
      await act(async () =>
        editor.update(
          () =>
            loadContentWithMentions(
              `/subagent ${mode} research Read @[task:12345678-1234-1234-1234-123456789012|Investigation]\nthen compare\n\nReport findings`
            ),
          { discrete: true }
        )
      );
      expect(read()).toEqual({
        kind: "ready",
        intent: {
          kind: "subagent",
          mode,
          capability: "research",
          objective:
            "Read @[task:12345678-1234-1234-1234-123456789012|Investigation]\nthen compare\n\nReport findings",
        },
      });
      await act(async () =>
        editor.update(() => {
          const first = $getRoot().getFirstChild();
          if ($isParagraphNode(first))
            first.append(
              $createFileReferenceNode({
                version: 1,
                serviceId: "service",
                serviceName: "UI",
                normalizedPath: "src/example.ts",
              })
            );
        })
      );
      const state = read();
      expect(state.kind === "ready" && state.intent.objective).toContain(
        "src/example.ts"
      );
      const restored = editor.parseEditorState(
        JSON.stringify(editor.getEditorState().toJSON())
      );
      expect(restored.read($readSubagentEditorState)).toEqual(read());
    }
  );

  it("keeps mid-message text and insertion-only editors literal", async () => {
    setup(false);
    await type("/subagent background research Inspect");
    expect(
      screen.queryByTestId("subagent-command-control")
    ).not.toBeInTheDocument();
    expect(read().kind).toBe("unconverted");
  });

  it("does not execute relocated controls or mid-message commands", async () => {
    setup();
    await type("Explain /subagent background research Inspect");
    expect(read().kind).toBe("literal");
    await type("/subagent foreground research Inspect");
    await act(async () =>
      editor.update(() => {
        const first = $getRoot().getFirstChild();
        if ($isParagraphNode(first)) {
          const control = first.getFirstChild();
          if ($isSubagentCommandNode(control))
            control.insertBefore($createTextNode("Explain "));
        }
      })
    );
    expect(read().kind).toBe("literal");
    expect(
      screen.queryByTestId("subagent-command-control")
    ).not.toBeInTheDocument();
  });

  it("supports undo and redo of control reversion", async () => {
    setup();
    await type("/subagent foreground research Inspect");
    await act(async () =>
      editor.dispatchCommand(
        KEY_BACKSPACE_COMMAND,
        new KeyboardEvent("keydown", { key: "Backspace" })
      )
    );
    expect(read().kind).toBe("unconverted");
    expect(editor.getEditorState().read(serializeEditorState)).toBe(
      "/subagent Inspect"
    );
    await act(async () => editor.dispatchCommand(UNDO_COMMAND, undefined));
    expect(read().kind).toBe("ready");
    await act(async () => editor.dispatchCommand(REDO_COMMAND, undefined));
    expect(read().kind).toBe("unconverted");
  });
});
