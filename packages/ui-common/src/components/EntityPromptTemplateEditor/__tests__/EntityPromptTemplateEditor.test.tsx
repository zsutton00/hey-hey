import { act } from "@testing-library/react";
import {
  CONTROLLED_TEXT_INSERTION_COMMAND,
  getNearestEditorFromDOMNode,
} from "lexical";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EntityPromptTemplateEditor } from "../EntityPromptTemplateEditor";

beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null });
});
function Harness({
  initial = "",
  onChange = () => {},
}: {
  initial?: string;
  onChange?: (source: string) => void;
}) {
  const [content, setContent] = useState(initial);
  return (
    <EntityPromptTemplateEditor
      source={{ content, syntaxVersion: "V1" }}
      readOnly={false}
      validation={{ status: "idle" }}
      onChange={(value) => {
        setContent(value);
        onChange(value);
      }}
    />
  );
}
function InvalidDraftHarness() {
  const [content, setContent] = useState("{{bad}} ");
  const source = { content, syntaxVersion: "V1" as const };
  return (
    <EntityPromptTemplateEditor
      source={source}
      readOnly={false}
      onChange={setContent}
      validation={{
        status: "invalid",
        source,
        issues: [
          {
            code: "UNSUPPORTED_INPUT",
            path: "content",
            message: "Unsupported field",
          },
        ],
      }}
    />
  );
}
describe("template editing", () => {
  it("reserves feedback space while validation changes from idle to pending to valid", () => {
    const source = { content: "Draft", syntaxVersion: "V1" as const };
    const props = { source, readOnly: false, onChange: vi.fn() };
    const { rerender } = render(
      <EntityPromptTemplateEditor {...props} validation={{ status: "idle" }} />
    );
    const feedback = screen.getByTestId("template-draft-validation");
    expect(feedback).toBeEmptyDOMElement();
    expect(feedback).toHaveStyle({ minHeight: "24px" });
    rerender(
      <EntityPromptTemplateEditor
        {...props}
        validation={{ status: "pending", source }}
      />
    );
    expect(feedback).toHaveTextContent("Checking template…");
    expect(feedback).toHaveStyle({ minHeight: "24px" });
    rerender(
      <EntityPromptTemplateEditor
        {...props}
        validation={{ status: "valid", source }}
      />
    );
    expect(feedback).toHaveTextContent("Template is valid.");
    expect(feedback).toHaveStyle({ minHeight: "24px" });
  });
  it.each(["escape", "selection", "no matches"])(
    "suppresses invalid feedback only while suggestions are visible, restoring it after %s",
    async (closeAction) => {
      const user = userEvent.setup();
      render(<InvalidDraftHarness />);
      expect(screen.getByTestId("template-validation-issue")).toHaveTextContent(
        "Unsupported field"
      );
      const input = screen.getByRole("textbox");
      await user.click(input);
      const editor = getNearestEditorFromDOMNode(input);
      await act(async () => {
        editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "{{");
      });
      await screen.findByTestId("template-substitution-suggestions");
      await waitFor(() =>
        expect(
          screen.queryByTestId("template-validation-issue")
        ).not.toBeInTheDocument()
      );
      if (closeAction === "escape") {
        await user.keyboard("{Escape}");
      } else if (closeAction === "selection") {
        await user.keyboard("{Enter}");
        expect(
          await screen.findByTestId("template-substitution")
        ).toHaveTextContent("{{entity.id}}");
      } else {
        await act(async () => {
          editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "unknown");
        });
      }
      await waitFor(() =>
        expect(
          screen.queryByTestId("template-substitution-suggestions")
        ).not.toBeInTheDocument()
      );
      expect(
        await screen.findByTestId("template-validation-issue")
      ).toHaveTextContent("Unsupported field");
    }
  );
  it.each(["$", "{{", "{{entity.", "{{ entity."])(
    "discovers substitutions with %s and inserts exact syntax through keyboard selection",
    async (trigger) => {
      const user = userEvent.setup();
      const change = vi.fn();
      render(<Harness onChange={change} />);
      await user.click(screen.getByRole("textbox"));
      const editor = getNearestEditorFromDOMNode(screen.getByRole("textbox"));
      // Lexical receives browser beforeinput text through this command; jsdom
      // does not implement the native contenteditable insertion default action.
      await act(async () => {
        editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, trigger);
      });
      expect(
        await screen.findByTestId("template-substitution-suggestions")
      ).toHaveTextContent("Focal entity identifier.");
      // The caret-positioning anchor can be zero-width. The menu must size
      // itself independently while staying bounded by the viewport.
      const menu = screen.getByTestId(
        "template-substitution-suggestions"
      ).parentElement;
      expect(menu).not.toBeNull();
      expect(menu?.parentElement).toHaveStyle({ width: "0px" });
      expect(menu).toHaveStyle({
        width: "480px",
        maxWidth: "calc(100vw - 32px)",
      });
      await user.keyboard("{Enter}");
      await waitFor(() =>
        expect(change).toHaveBeenLastCalledWith("{{entity.id}}")
      );
      expect(screen.getByTestId("template-substitution")).toHaveTextContent(
        "{{entity.id}}"
      );
    }
  );
  it("waits for the complete opening delimiter and filters context fields without losing surrounding text", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<Harness onChange={change} />);
    const input = screen.getByRole("textbox");
    await user.click(input);
    const editor = getNearestEditorFromDOMNode(input);
    await act(async () => {
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "Intro:{");
    });
    expect(
      screen.queryByTestId("template-substitution-suggestions")
    ).not.toBeInTheDocument();
    await act(async () => {
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "{");
    });
    expect(
      await screen.findByTestId("template-substitution-suggestions")
    ).toHaveTextContent("entity.id");
    await act(async () => {
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "context.");
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("template-substitution-suggestions")
      ).not.toHaveTextContent("entity.id")
    );
    await user.click(screen.getByRole("option", { name: /context.entityId/ }));
    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith("Intro:{{context.entityId}}")
    );
  });
  it("preserves pasted source and supports atomic deletion, undo and redo", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<Harness onChange={change} />);
    const input = screen.getByRole("textbox");
    await user.click(input);
    const source =
      "\t\r\n{{ entity.name }}{{context.relatedEntities}}\n{{bad}}";
    await user.paste(source);
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(source));
    expect(screen.getAllByTestId("template-substitution")).toHaveLength(2);
    await user.keyboard("{Control>}a{/Control}");
    const clipboard = { setData: vi.fn() };
    fireEvent.copy(input, { clipboardData: clipboard });
    expect(clipboard.setData).toHaveBeenCalledWith("text/plain", source);
    await user.keyboard("{Backspace}");
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(""));
    await user.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(source));
    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    await waitFor(() => expect(change).toHaveBeenLastCalledWith(""));
  });
  it("loads external resets without emitting edits and shows only current diagnostics", async () => {
    const change = vi.fn();
    const props = {
      readOnly: false,
      onChange: change,
      validation: { status: "idle" as const },
    };
    const { rerender } = render(
      <EntityPromptTemplateEditor
        {...props}
        source={{ content: "old", syntaxVersion: "V1" }}
      />
    );
    rerender(
      <EntityPromptTemplateEditor
        {...props}
        source={{ content: "\r\n{{ entity.name }}", syntaxVersion: "V1" }}
      />
    );
    await screen.findByTestId("template-substitution");
    expect(change).not.toHaveBeenCalled();
    rerender(
      <EntityPromptTemplateEditor
        {...props}
        source={{ content: "{{bad}}", syntaxVersion: "V1" }}
        validation={{
          status: "invalid",
          source: { content: "{{bad}}", syntaxVersion: "V1" },
          issues: [
            {
              code: "UNSUPPORTED_INPUT",
              path: "content",
              message: "Unsupported field",
            },
          ],
        }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "content: Unsupported field"
    );
  });
  it("retains composition text and recognizes a completed substitution", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(<Harness onChange={change} />);
    const input = screen.getByRole("textbox");
    await user.click(input);
    const editor = getNearestEditorFromDOMNode(input);
    fireEvent.compositionStart(input, { data: "" });
    await act(async () => {
      editor.dispatchCommand(
        CONTROLLED_TEXT_INSERTION_COMMAND,
        "{{entity.name}}"
      );
    });
    fireEvent.compositionEnd(input, { data: "{{entity.name}}" });
    await waitFor(() =>
      expect(change).toHaveBeenLastCalledWith("{{entity.name}}")
    );
    expect(
      await screen.findByTestId("template-substitution")
    ).toHaveTextContent("{{entity.name}}");
  });
});
