import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FileReferenceCandidatesState } from "../../../data/hooks/useFileReferenceCandidates";
import { FileReferencePlugin } from "../fileReferences/FileReferencePlugin";
import { FileReferenceNode } from "../fileReferences/FileReferenceNode";
import { FILE_REFERENCE_POPUP_WIDTH } from "../fileReferences/FileReferencePopup";

const useFileReferenceCandidatesMock = vi.fn<
  () => FileReferenceCandidatesState
>(() => ({
  status: "empty" as const,
  candidates: [] as const,
  isFetching: false as const,
}));

const SetEditorText = () => {
  const [editor] = useLexicalComposerContext();
  const setText = (value: string) => {
    editor.update(() => {
      const text = $createTextNode(value);
      $getRoot().clear().append($createParagraphNode().append(text));
      text.selectEnd();
    });
  };

  return (
    <>
      <button onClick={() => setText("@")} data-testid="activate-trigger" />
      <button onClick={() => setText("@src")} data-testid="activate-query" />
      <button onClick={() => setText("@ ")} data-testid="clear-trigger" />
      <button data-testid="outside-control" />
    </>
  );
};

vi.mock("../../../data/hooks/useFileReferenceCandidates", () => ({
  useFileReferenceCandidates: (input: unknown) =>
    useFileReferenceCandidatesMock(input),
}));

const renderPlugin = () =>
  render(
    <LexicalComposer
      initialConfig={{
        namespace: "file-reference-test",
        onError: vi.fn(),
        nodes: [FileReferenceNode],
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable data-testid="editor" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <FileReferencePlugin
        config={{
          organizationId: "org-1",
          projectId: "project-1",
          scope: { kind: "task", taskId: "task-1" },
        }}
      />
      <SetEditorText />
    </LexicalComposer>
  );

describe("FileReferencePlugin", () => {
  const candidates = [
    {
      serviceId: "service-1",
      serviceName: "API",
      normalizedPath: "src/a.ts",
    },
    {
      serviceId: "service-2",
      serviceName: "UI Common",
      normalizedPath: "src/b.ts",
    },
  ];

  it("activates only while a valid @ trigger is at the caret", async () => {
    useFileReferenceCandidatesMock.mockReturnValue({
      status: "empty",
      candidates: [],
      isFetching: false,
    });
    renderPlugin();

    expect(useFileReferenceCandidatesMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("activate-trigger"));

    expect(
      await screen.findByTestId("file-reference-popup")
    ).toBeInTheDocument();
    expect(useFileReferenceCandidatesMock).toHaveBeenLastCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      scope: { kind: "task", taskId: "task-1" },
      active: true,
    });

    fireEvent.click(screen.getByTestId("clear-trigger"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("file-reference-popup")
      ).not.toBeInTheDocument()
    );
  });

  it("uses a wider viewport-safe popup while preserving the anchored picker", async () => {
    useFileReferenceCandidatesMock.mockReturnValue({
      status: "empty",
      candidates: [],
      isFetching: false,
    });
    renderPlugin();

    fireEvent.click(screen.getByTestId("activate-trigger"));

    const popup = await screen.findByTestId("file-reference-popup");
    expect(popup).toHaveStyle({
      width: `min(${FILE_REFERENCE_POPUP_WIDTH}px, calc(100vw - 8px))`,
      maxWidth: "calc(100vw - 8px)",
    });
  });

  it("dismisses the picker when the editor loses focus outside", async () => {
    useFileReferenceCandidatesMock.mockReturnValue({
      status: "empty",
      candidates: [],
      isFetching: false,
    });
    renderPlugin();
    fireEvent.click(screen.getByTestId("activate-trigger"));

    const editor = screen.getByTestId("editor");
    await screen.findByTestId("file-reference-popup");
    fireEvent.blur(editor, {
      relatedTarget: screen.getByTestId("outside-control"),
    });

    await waitFor(() =>
      expect(
        screen.queryByTestId("file-reference-popup")
      ).not.toBeInTheDocument()
    );
  });

  it("dismisses the picker on an outside mouse interaction", async () => {
    useFileReferenceCandidatesMock.mockReturnValue({
      status: "empty",
      candidates: [],
      isFetching: false,
    });
    renderPlugin();
    fireEvent.click(screen.getByTestId("activate-trigger"));
    await screen.findByTestId("file-reference-popup");

    fireEvent.mouseDown(screen.getByTestId("outside-control"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("file-reference-popup")
      ).not.toBeInTheDocument()
    );
  });

  it("dismisses on Escape without inserting or submitting", async () => {
    useFileReferenceCandidatesMock.mockReturnValue({
      status: "ready",
      candidates,
      isFetching: false,
    });
    renderPlugin();
    fireEvent.click(screen.getByTestId("activate-query"));

    const editor = screen.getByTestId("editor");
    await screen.findByTestId("file-reference-popup");
    const escapeEvent = createEvent.keyDown(editor, { key: "Escape" });
    fireEvent(editor, escapeEvent);

    await waitFor(() =>
      expect(
        screen.queryByTestId("file-reference-popup")
      ).not.toBeInTheDocument()
    );
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(editor).toHaveTextContent("@src");
    expect(screen.queryByTestId("file-reference")).not.toBeInTheDocument();
  });

  it("commits a clicked row through the retained trigger range", async () => {
    useFileReferenceCandidatesMock.mockReturnValue({
      status: "ready",
      candidates,
      isFetching: false,
    });
    renderPlugin();
    fireEvent.click(screen.getByTestId("activate-query"));

    const rows = await screen.findAllByTestId("file-reference-candidate-row");
    fireEvent.mouseDown(rows[1]);
    fireEvent.click(rows[1]);

    await waitFor(() => {
      expect(screen.getByTestId("file-reference")).toHaveTextContent(
        "UI Common/src/b.ts"
      );
      expect(
        screen.queryByTestId("file-reference-popup")
      ).not.toBeInTheDocument();
    });
  });

  it("uses the rendered order for ArrowDown and Enter selection", async () => {
    useFileReferenceCandidatesMock.mockReturnValue({
      status: "ready",
      candidates,
      isFetching: false,
    });
    renderPlugin();
    fireEvent.click(screen.getByTestId("activate-trigger"));

    const editor = screen.getByTestId("editor");
    const rows = await screen.findAllByTestId("file-reference-candidate-row");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(editor, { key: "ArrowDown" });
    await waitFor(() =>
      expect(rows[1]).toHaveAttribute("aria-selected", "true")
    );
    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("file-reference")).toHaveTextContent(
        "UI Common/src/b.ts"
      )
    );
  });

  it("refuses selection while visible candidates are updating", async () => {
    useFileReferenceCandidatesMock.mockReturnValue({
      status: "updating",
      candidates,
      isFetching: true,
    });
    renderPlugin();
    fireEvent.click(screen.getByTestId("activate-trigger"));

    const editor = screen.getByTestId("editor");
    const rows = await screen.findAllByTestId("file-reference-candidate-row");
    fireEvent.click(rows[0]);
    fireEvent.keyDown(editor, { key: "Enter" });

    expect(editor).toHaveTextContent("@");
    expect(editor).not.toHaveTextContent("API/src/a.ts");
  });
});
