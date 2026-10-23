import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import type { Components } from "react-markdown";
import {
  SystemMessage,
  useSystemMessageMarkdownComponents,
} from "../SystemMessage";
import { EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY } from "../../../EditorPreference/editorPreference";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../shared/MermaidCodeBlock", () => ({
  MermaidCodeBlock: ({ code }: { code: string }) => (
    <div data-testid="markdown-mermaid-block">{code}</div>
  ),
}));

interface SystemMessageCodeProps extends React.ComponentProps<"code"> {
  node?: unknown;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const theme = (() => {
  const nextTheme = createTheme();
  (nextTheme.palette as Record<string, unknown>).attention = {
    main: "#1976d2",
    light: "#63a4ff",
    dark: "#004ba0",
    contrastText: "#ffffff",
  };
  return nextTheme;
})();

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
);

const getSystemMessageMarkdownComponents = (): Components => {
  const { result } = renderHook(() => useSystemMessageMarkdownComponents(), {
    wrapper,
  });

  return result.current;
};

describe("SystemMessage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("routes fenced mermaid code blocks to MermaidCodeBlock", async () => {
    const components = getSystemMessageMarkdownComponents();
    const CodeComponent =
      components.code as React.ComponentType<SystemMessageCodeProps>;

    render(
      <ThemeProvider theme={theme}>
        <CodeComponent className="language-mermaid">
          {"graph TD;\nA-->B;"}
        </CodeComponent>
      </ThemeProvider>
    );

    expect(
      await screen.findByTestId("markdown-mermaid-block")
    ).toBeInTheDocument();
  });

  it("renders response text alongside the AGENT thinking indicator", () => {
    render(
      <ThemeProvider theme={theme}>
        <SystemMessage
          animationType="minimal"
          isThinking
          type="AGENT"
          messageData={{
            type: "AGENT",
            response: "Sketching out the stages...",
          }}
        />
      </ThemeProvider>
    );

    expect(screen.getByText("Sketching out the stages...")).toBeInTheDocument();
  });

  it("keeps non-mermaid fenced code blocks as standard code", () => {
    const components = getSystemMessageMarkdownComponents();
    const CodeComponent =
      components.code as React.ComponentType<SystemMessageCodeProps>;

    const { container } = render(
      <ThemeProvider theme={theme}>
        <CodeComponent className="language-ts">const value = 1;</CodeComponent>
      </ThemeProvider>
    );

    expect(
      screen.queryByTestId("markdown-mermaid-block")
    ).not.toBeInTheDocument();
    const codeElement = container.querySelector("code");
    expect(codeElement).not.toBeNull();
    expect(codeElement).toHaveTextContent("const value = 1;");
  });

  it("opens setup on the first source-link click and cancellation does not navigate", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const components = getSystemMessageMarkdownComponents();
    const Anchor = components.a as React.ComponentType<
      React.ComponentProps<"a"> & { node?: unknown }
    >;
    render(
      <ThemeProvider theme={theme}>
        <Anchor href="/Users/zac/project/file.ts:42">source</Anchor>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId("system-message-source-link"));
    expect(
      screen.getByTestId("external-editor-setup-dialog")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("external-editor-cancel"));

    expect(open).not.toHaveBeenCalled();
    await waitForElementToBeRemoved(() =>
      screen.queryByTestId("external-editor-setup-dialog")
    );
  });

  it("saves the VS Code preset and opens the pending source reference", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const components = getSystemMessageMarkdownComponents();
    const Anchor = components.a as React.ComponentType<
      React.ComponentProps<"a"> & { node?: unknown }
    >;
    render(
      <ThemeProvider theme={theme}>
        <Anchor href="/Users/zac/My%20Project/file.ts:42:7">source</Anchor>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId("system-message-source-link"));
    fireEvent.click(screen.getByTestId("external-editor-save"));

    expect(localStorage.getItem(EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY)).toBe(
      JSON.stringify({ kind: "preset", editor: "vscode" })
    );
    expect(open).toHaveBeenCalledWith(
      "vscode://file/Users/zac/My%20Project/file.ts:42:7",
      "_self",
      "noopener,noreferrer"
    );
  });

  it("uses a previously configured custom template on later clicks", () => {
    localStorage.setItem(
      EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        kind: "custom",
        urlTemplate: "cursor://file/{path}:{line}:{column}",
      })
    );
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const components = getSystemMessageMarkdownComponents();
    const Anchor = components.a as React.ComponentType<
      React.ComponentProps<"a"> & { node?: unknown }
    >;
    render(
      <ThemeProvider theme={theme}>
        <Anchor href="/tmp/file.ts:8">source</Anchor>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId("system-message-source-link"));

    expect(open).toHaveBeenCalledWith(
      "cursor://file//tmp/file.ts:8:1",
      "_self",
      "noopener,noreferrer"
    );
    expect(
      screen.queryByTestId("external-editor-setup-dialog")
    ).not.toBeInTheDocument();
  });

  it("treats malformed persisted data as unconfigured", () => {
    localStorage.setItem(EXTERNAL_EDITOR_PREFERENCE_STORAGE_KEY, "{malformed");
    const components = getSystemMessageMarkdownComponents();
    const Anchor = components.a as React.ComponentType<
      React.ComponentProps<"a"> & { node?: unknown }
    >;
    render(
      <ThemeProvider theme={theme}>
        <Anchor href="/tmp/file.ts:8">source</Anchor>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId("system-message-source-link"));

    expect(
      screen.getByTestId("external-editor-setup-dialog")
    ).toBeInTheDocument();
  });

  it("leaves external links unchanged and recognizes absolute paths without locations", () => {
    const components = getSystemMessageMarkdownComponents();
    const Anchor = components.a as React.ComponentType<
      React.ComponentProps<"a"> & { node?: unknown }
    >;
    const { rerender } = render(
      <ThemeProvider theme={theme}>
        <Anchor href="https://localhost:5173/file.ts:42">external</Anchor>
      </ThemeProvider>
    );

    expect(screen.getByRole("link", { name: "external" })).toHaveAttribute(
      "target",
      "_blank"
    );
    expect(
      screen.queryByTestId("system-message-source-link")
    ).not.toBeInTheDocument();

    rerender(
      <ThemeProvider theme={theme}>
        <Anchor href="/Users/zac/project/file.ts">path</Anchor>
      </ThemeProvider>
    );
    expect(screen.getByTestId("system-message-source-link")).toHaveAttribute(
      "href",
      "#"
    );
  });

  it("recovers a machine path from a same-origin browser-resolved URL", () => {
    const components = getSystemMessageMarkdownComponents();
    const Anchor = components.a as React.ComponentType<
      React.ComponentProps<"a"> & { node?: unknown }
    >;
    render(
      <ThemeProvider theme={theme}>
        <Anchor href={`${window.location.origin}/Users/zac/project/file.ts`}>
          source
        </Anchor>
      </ThemeProvider>
    );

    const sourceLink = screen.getByTestId("system-message-source-link");
    expect(sourceLink).toHaveAttribute("href", "#");
    fireEvent.click(sourceLink);
    expect(
      screen.getByTestId("external-editor-setup-dialog")
    ).toBeInTheDocument();
  });

  it("does not recover a machine-looking path from another web origin", () => {
    const components = getSystemMessageMarkdownComponents();
    const Anchor = components.a as React.ComponentType<
      React.ComponentProps<"a"> & { node?: unknown }
    >;
    render(
      <ThemeProvider theme={theme}>
        <Anchor href="https://example.com/Users/zac/project/file.ts">
          external
        </Anchor>
      </ThemeProvider>
    );

    expect(screen.getByRole("link", { name: "external" })).toHaveAttribute(
      "href",
      "https://example.com/Users/zac/project/file.ts"
    );
    expect(
      screen.queryByTestId("system-message-source-link")
    ).not.toBeInTheDocument();
  });

  it("opens setup for an absolute path without a line location", () => {
    const components = getSystemMessageMarkdownComponents();
    const Anchor = components.a as React.ComponentType<
      React.ComponentProps<"a"> & { node?: unknown }
    >;
    render(
      <ThemeProvider theme={theme}>
        <Anchor href="/Users/zac/project/file.ts">source</Anchor>
      </ThemeProvider>
    );

    fireEvent.click(screen.getByTestId("system-message-source-link"));

    expect(
      screen.getByTestId("external-editor-setup-dialog")
    ).toBeInTheDocument();
  });
});
