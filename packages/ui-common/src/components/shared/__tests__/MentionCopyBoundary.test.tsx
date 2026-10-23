import React from "react";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { renderInlineMentions } from "../../SmarterTextAreaCard/renderInlineMentions";
import { MarkdownRenderer } from "../MarkdownRenderer";

class ClipboardDataStore {
  private readonly values = new Map<string, string>();

  setData(format: string, data: string): void {
    this.values.set(format, data);
  }

  getData(format: string): string {
    return this.values.get(format) ?? "";
  }
}

const createClipboardEvent = (
  clipboardData: ClipboardDataStore
): ClipboardEvent => {
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  return event as ClipboardEvent;
};

const selectNode = (node: Node): void => {
  const range = document.createRange();
  range.selectNode(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const selectNodeContents = (node: Node): void => {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const dispatchCopy = (target: HTMLElement) => {
  const clipboardData = new ClipboardDataStore();
  const event = createClipboardEvent(clipboardData);
  target.dispatchEvent(event);
  return { clipboardData, event };
};

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
  </MemoryRouter>
);

afterEach(() => {
  window.getSelection()?.removeAllRanges();
});

describe("MentionCopyBoundary", () => {
  it("copies a standalone Markdown mention as canonical text and readable identity-bearing HTML", () => {
    render(
      <MarkdownRenderer mentionMode="minimal">
        {"@[task:task-1|Prepare launch]"}
      </MarkdownRenderer>,
      { wrapper }
    );

    const mention = screen.getByTestId("mention-badge");
    selectNode(mention);
    const { clipboardData, event } = dispatchCopy(mention);

    expect(event.defaultPrevented).toBe(true);
    expect(clipboardData.getData("text/plain")).toBe(
      "@[task:task-1|Prepare launch]"
    );

    const htmlContainer = document.createElement("div");
    htmlContainer.innerHTML = clipboardData.getData("text/html");
    const copiedMention = htmlContainer.querySelector(".mention-node");
    expect(copiedMention).toHaveTextContent("Prepare launch");
    expect(copiedMention).toHaveAttribute("data-entity-type", "task");
    expect(copiedMention).toHaveAttribute("data-entity-id", "task-1");
    expect(copiedMention).toHaveAttribute(
      "data-mention-token",
      "@[task:task-1|Prepare launch]"
    );
  });

  it("preserves prose and ordered canonical tokens for a mixed multi-mention inline selection", () => {
    render(
      <p data-testid="mixed-content">
        {renderInlineMentions(
          "Open @[feature:feature-1|Launch] before @[task:task-2|Announce release]."
        )}
      </p>,
      { wrapper }
    );

    const content = screen.getByTestId("mixed-content");
    selectNodeContents(content);
    const boundary = screen.getByTestId("mention-copy-boundary");
    const { clipboardData, event } = dispatchCopy(boundary);

    expect(event.defaultPrevented).toBe(true);
    expect(clipboardData.getData("text/plain")).toBe(
      "Open @[feature:feature-1|Launch] before @[task:task-2|Announce release]."
    );

    const htmlContainer = document.createElement("div");
    htmlContainer.innerHTML = clipboardData.getData("text/html");
    const copiedMentions = Array.from(
      htmlContainer.querySelectorAll<HTMLElement>(".mention-node")
    );
    expect(copiedMentions).toHaveLength(2);
    expect(copiedMentions.map((mention) => mention.textContent)).toEqual([
      "Launch",
      "Announce release",
    ]);
    expect(htmlContainer.textContent).toBe(
      "Open Launch before Announce release."
    );
  });

  it("leaves native copy behavior untouched when the selection excludes mentions", () => {
    render(
      <p data-testid="mixed-content">
        {renderInlineMentions("Prefix @[task:task-1|Prepare launch] suffix")}
      </p>,
      { wrapper }
    );

    const content = screen.getByTestId("mixed-content");
    const prefixText = content.firstChild?.firstChild;
    expect(prefixText?.textContent).toBe("Prefix ");
    if (!prefixText) {
      throw new Error("Expected the inline mention prefix text node");
    }
    selectNodeContents(prefixText);

    const boundary = screen.getByTestId("mention-copy-boundary");
    const { clipboardData, event } = dispatchCopy(boundary);

    expect(event.defaultPrevented).toBe(false);
    expect(clipboardData.getData("text/plain")).toBe("");
    expect(clipboardData.getData("text/html")).toBe("");
  });
});
