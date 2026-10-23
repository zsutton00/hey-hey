import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  getPromptSubmitShortcut,
  PromptEditorInstructions,
} from "../PromptEditorInstructions";

const canHoverState = { value: true };

vi.mock("../../../hooks/useCanHover", () => ({
  useCanHover: () => canHoverState.value,
}));

describe("PromptEditorInstructions", () => {
  beforeEach(() => {
    canHoverState.value = true;
  });

  it("uses the Command key on macOS", () => {
    expect(getPromptSubmitShortcut("MacIntel")).toBe("⌘+Enter");
  });

  it("uses the Control key on non-macOS platforms", () => {
    expect(getPromptSubmitShortcut("Win32")).toBe("Ctrl+Enter");
    expect(getPromptSubmitShortcut("Linux x86_64")).toBe("Ctrl+Enter");
  });

  it("explains mentions, slash commands, and the submit shortcut", () => {
    render(<PromptEditorInstructions />);

    expect(screen.getByTestId("prompt-editor-instructions")).toHaveTextContent(
      "Use / for commands.",
    );
    expect(screen.getByTestId("prompt-editor-instructions")).toHaveTextContent(
      /Press (⌘|Ctrl)\+Enter to submit\./,
    );
  });

  it("omits keyboard guidance on touch devices", () => {
    canHoverState.value = false;

    render(<PromptEditorInstructions />);

    expect(
      screen.queryByTestId("prompt-editor-instructions")
    ).not.toBeInTheDocument();
  });
});
