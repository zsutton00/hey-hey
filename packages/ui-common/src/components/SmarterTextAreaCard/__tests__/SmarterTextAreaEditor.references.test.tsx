import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataHooksProvider } from "../../../data/DataHooksProvider";
import { SmarterTextAreaEditor } from "../SmarterTextAreaEditor";

const editorRef = vi.hoisted(
  (): { current: LexicalEditor | null } => ({ current: null }),
);
const listWorkItemReferences = vi.hoisted(() => vi.fn());

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { listWorkItemReferences },
}));

vi.mock("../../../data/hooks/useCachedConversationMentionOptions", () => ({
  useCachedConversationMentionOptions: () => [],
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({ workItemTypes: [] }),
  useWorkItemTypeByKey: () => ({
    isReady: false,
    workItemTypeDefinition: undefined,
  }),
}));

vi.mock("../EntityDropPlugin", async () => {
  const { useLexicalComposerContext } = await import(
    "@lexical/react/LexicalComposerContext"
  );

  return {
    EntityDropPlugin: () => {
      const [editor] = useLexicalComposerContext();
      editorRef.current = editor;
      return null;
    },
  };
});

const referencePage = {
  data: {
    data: {
      items: [
        {
          id: "feature-search",
          name: "Feature Search",
          type: "FEATURE",
          parentTaskId: null,
        },
      ],
      pagination: {
        page: 1,
        limit: 500,
        total: 1,
        totalPages: 1,
        hasNext: false,
        hasPrevious: false,
      },
    },
  },
};

describe("SmarterTextAreaEditor reference loading", () => {
  beforeEach(() => {
    editorRef.current = null;
    listWorkItemReferences.mockReset();
    listWorkItemReferences.mockResolvedValue(referencePage);
  });

  it("loads project feature references and discovers a completed title", async () => {
    render(
      <DataHooksProvider>
        <MemoryRouter>
          <SmarterTextAreaEditor
            context={{
              organizationId: "org-references",
              projectId: "project-references",
              conversationId: null,
            }}
            initialValue=""
            onChange={vi.fn()}
            presentation={{ contentEditableTestId: "editor" }}
          />
        </MemoryRouter>
      </DataHooksProvider>,
    );

    await waitFor(() => expect(editorRef.current).not.toBeNull());
    await waitFor(() =>
      expect(listWorkItemReferences).toHaveBeenCalledWith({
        organizationId: "org-references",
        projectId: "project-references",
        type: "FEATURE",
        page: 1,
        limit: 500,
      }, expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );

    const editor = editorRef.current;
    if (!editor) throw new Error("Lexical editor was not mounted");

    await waitFor(() => {
      expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("");
    });

    editor.update(() => {
      const textNode = $createTextNode("Feature Search");
      $getRoot().clear().append($createParagraphNode().append(textNode));
      textNode.selectEnd();
    });
    editor.update(() => {
      const textNode = $getRoot().getAllTextNodes().at(-1);
      if (!textNode) return;
      textNode.setTextContent(`${textNode.getTextContent()} `);
      textNode.selectEnd();
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("editor").querySelectorAll(
          ".feature-reference-match-node",
        ),
      ).toHaveLength(1),
    );
  });
});
