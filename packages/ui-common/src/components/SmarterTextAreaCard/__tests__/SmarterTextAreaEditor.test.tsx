import { MemoryRouter } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkItemReferencesState } from "../../../data/hooks/useWorkItemReferences";
import { SmarterTextAreaEditor } from "../SmarterTextAreaEditor";

const readyState: WorkItemReferencesState = {
  status: "ready",
  references: [
    {
      id: "feature-search",
      name: "Feature Search",
      type: "FEATURE",
      parentTaskId: null,
    },
  ],
  isFetching: false,
};

let referencesState = readyState;
const editorRef = vi.hoisted((): { current: LexicalEditor | null } => ({
  current: null,
}));

vi.mock("../../../data/hooks/useWorkItemReferences", () => ({
  useWorkItemReferences: () => referencesState,
}));

vi.mock("../../../data/hooks/useCachedConversationMentionOptions", () => ({
  useCachedConversationMentionOptions: () => [],
}));

vi.mock("../../../data/hooks/useMentionEntitySearch", () => ({
  useMentionEntitySearch: () => ({ searchEntities: vi.fn() }),
}));

vi.mock("../EntityDropPlugin", () => ({
  EntityDropPlugin: () => null,
}));

vi.mock("../slashCommands/RichSlashCommandPlugin", async () => {
  const { useLexicalComposerContext } = await import(
    "@lexical/react/LexicalComposerContext"
  );

  return {
    RichSlashCommandPlugin: () => {
      const [editor] = useLexicalComposerContext();
      editorRef.current = editor;
      return null;
    },
  };
});

describe("SmarterTextAreaEditor", () => {
  beforeEach(() => {
    referencesState = readyState;
    editorRef.current = null;
  });

  it("restores typed subagent choices and gates the submit shortcut", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const view = (value: string, key: number, submitDisabled: boolean) => (
      <MemoryRouter>
        <SmarterTextAreaEditor
          context={null}
          initialValue={value}
          reset={{ key, value }}
          subagentCommandAvailable
          onChange={onChange}
          onSubmit={onSubmit}
          submitDisabled={submitDisabled}
        />
      </MemoryRouter>
    );
    const rendered = render(
      view("/subagent background research Inspect", 0, false)
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        "/subagent background research Inspect",
        {
          kind: "ready",
          intent: {
            kind: "subagent",
            mode: "background",
            capability: "research",
            objective: "Inspect",
          },
        }
      )
    );
    await act(async () =>
      editorRef.current?.dispatchCommand(
        KEY_ENTER_COMMAND,
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true })
      )
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rendered.rerender(view("/subagent ", 1, true));
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        "/subagent foreground research ",
        {
          kind: "empty",
          choices: { mode: "foreground", capability: "research" },
        }
      )
    );
    await act(async () =>
      editorRef.current?.dispatchCommand(
        KEY_ENTER_COMMAND,
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true })
      )
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("discovers a feature title typed into a project-aware editor", async () => {
    render(
      <MemoryRouter>
        <SmarterTextAreaEditor
          context={{
            organizationId: "org-1",
            projectId: "project-1",
            conversationId: null,
          }}
          initialValue=""
          onChange={vi.fn()}
          presentation={{ contentEditableTestId: "editor" }}
        />
      </MemoryRouter>
    );

    const domEditor = screen.getByTestId("editor");
    await waitFor(() => expect(editorRef.current).not.toBeNull());
    const editor = editorRef.current;
    if (!editor) throw new Error("Lexical editor was not mounted");

    editor.update(() => {
      const textNode = $createTextNode("Feature Search");
      $getRoot().clear().append($createParagraphNode().append(textNode));
      textNode.selectEnd();
    });

    expect(
      domEditor.querySelectorAll(".feature-reference-match-node")
    ).toHaveLength(0);

    editor.update(() => {
      const textNode = $getRoot().getAllTextNodes().at(-1);
      textNode?.setTextContent(`${textNode.getTextContent()} `);
      textNode?.selectEnd();
    });

    await waitFor(() =>
      expect(
        domEditor.querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );
  });

  it("discovers a feature title in an initial draft", async () => {
    render(
      <MemoryRouter>
        <SmarterTextAreaEditor
          context={{
            organizationId: "org-1",
            projectId: "project-1",
            conversationId: null,
          }}
          initialValue="Feature Search"
          onChange={vi.fn()}
          presentation={{ contentEditableTestId: "editor" }}
        />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(
        screen
          .getByTestId("editor")
          .querySelectorAll(".feature-reference-match-node")
      ).toHaveLength(1)
    );
  });

  it("focuses an empty editor on the first focus signal", async () => {
    const { rerender } = render(
      <MemoryRouter>
        <SmarterTextAreaEditor
          context={{
            organizationId: "org-1",
            projectId: "project-1",
            conversationId: null,
          }}
          initialValue=""
          onChange={vi.fn()}
          presentation={{
            contentEditableTestId: "editor",
            focusSignal: 0,
          }}
        />
      </MemoryRouter>
    );

    const domEditor = screen.getByTestId("editor");
    await waitFor(() => expect(editorRef.current).not.toBeNull());

    rerender(
      <MemoryRouter>
        <SmarterTextAreaEditor
          context={{
            organizationId: "org-1",
            projectId: "project-1",
            conversationId: null,
          }}
          initialValue=""
          onChange={vi.fn()}
          presentation={{
            contentEditableTestId: "editor",
            focusSignal: 1,
          }}
        />
      </MemoryRouter>
    );

    await waitFor(() => expect(domEditor).toHaveFocus());
  });
});
