import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { MermaidCodeBlock, normalizeMermaidCode } from "../MermaidCodeBlock";

const initializeMock = vi.fn();
const renderMock = vi.fn();
const registerLayoutLoadersMock = vi.fn();

vi.mock("mermaid", () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
    registerLayoutLoaders: registerLayoutLoadersMock,
  },
}));

vi.mock("@mermaid-js/layout-elk", () => ({
  default: { name: "elk-loader" },
}));

const renderWithTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

describe("MermaidCodeBlock", () => {
  beforeEach(() => {
    initializeMock.mockReset();
    renderMock.mockReset();
  });

  it("normalizes syntax-sensitive characters inside edge labels", () => {
    expect(
      normalizeMermaidCode(
        'flowchart TD\nUser -->|Click "Think with Code" (beta)| App'
      )
    ).toBe("flowchart TD\nUser -->|Click ”Think with Code” （beta）| App");
  });

  it("normalizes syntax-sensitive characters inside node labels", () => {
    expect(
      normalizeMermaidCode(
        'flowchart TD\nA[User "Admin" (primary)]\nB((Queue (async)))'
      )
    ).toBe("flowchart TD\nA[User ”Admin” （primary）]\nB((Queue （async）))");
  });

  it("replaces literal backslash-n sequences in unquoted labels with spaces", () => {
    expect(
      normalizeMermaidCode("flowchart TD\nA[Approval recorded\\ncount: 1 of 2]")
    ).toBe("flowchart TD\nA[Approval recorded count: 1 of 2]");
  });

  it("preserves quoted label contents so mermaid can handle special chars natively", () => {
    const input =
      'flowchart TD\nE["Proposal tagged with\\napproval requirements:\\n{ required: 2, current: 0 }"]';
    expect(normalizeMermaidCode(input)).toBe(input);
  });

  it("renders SVG output when Mermaid succeeds", async () => {
    renderMock.mockResolvedValue({
      svg: "<svg><text>Rendered diagram</text></svg>",
    });

    const { container } = renderWithTheme(
      <MermaidCodeBlock code={"graph TD;\nA-->B;"} />
    );

    await waitFor(() => {
      expect(container.querySelector("svg")).not.toBeNull();
    });

    expect(
      screen.queryByTestId("markdown-mermaid-error")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("markdown-mermaid-fallback-code")
    ).not.toBeInTheDocument();
  });

  it("shows warning and source fallback when Mermaid render fails", async () => {
    renderMock.mockRejectedValue(new Error("Parse error"));

    renderWithTheme(<MermaidCodeBlock code={"graph TD;\nA-->B;"} />);

    await screen.findByTestId("markdown-mermaid-error");

    expect(screen.getByTestId("markdown-mermaid-error")).toHaveTextContent(
      "Unable to render Mermaid diagram. Parse error"
    );
    const fallbackCode = screen.getByTestId("markdown-mermaid-fallback-code");
    expect(fallbackCode).toHaveTextContent("graph TD;");
    expect(fallbackCode).toHaveTextContent("A-->B;");
  });

  it("passes normalized mermaid text to the renderer", async () => {
    renderMock.mockResolvedValue({
      svg: "<svg><text>Rendered diagram</text></svg>",
    });

    renderWithTheme(
      <MermaidCodeBlock
        code={'flowchart TD\nUser -->|Click "Think with Code" (beta)| App'}
      />
    );

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1);
    });

    expect(renderMock).toHaveBeenCalledWith(
      expect.any(String),
      "flowchart TD\nUser -->|Click ”Think with Code” （beta）| App",
      expect.any(HTMLDivElement)
    );
  });

  it("renders Mermaid into a component-owned host element", async () => {
    renderMock.mockResolvedValue({
      svg: "<svg><text>Rendered diagram</text></svg>",
    });

    renderWithTheme(<MermaidCodeBlock code={"graph TD;\nA-->B;"} />);

    const renderHost = screen.getByTestId("markdown-mermaid-render-host");

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1);
    });

    expect(renderMock.mock.calls[0]?.[2]).toBe(renderHost);
    expect(renderHost.parentElement).toBe(
      screen.getByTestId("markdown-mermaid-block")
    );
  });

  it("shows loading state before Mermaid render completes", async () => {
    let resolveRender: ((result: { svg: string }) => void) | undefined;

    renderMock.mockImplementation(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          resolveRender = resolve;
        })
    );

    const { container } = renderWithTheme(
      <MermaidCodeBlock code={"graph TD;\nA-->B;"} />
    );

    expect(screen.getByText("Rendering diagram...")).toBeInTheDocument();

    await waitFor(() => {
      expect(renderMock).toHaveBeenCalledTimes(1);
      expect(resolveRender).toBeDefined();
    });

    resolveRender?.({ svg: "<svg><text>Done</text></svg>" });

    await waitFor(() => {
      expect(
        screen.queryByText("Rendering diagram...")
      ).not.toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
    });
  });

  it("opens and closes the near-fullscreen viewer", async () => {
    renderMock.mockResolvedValue({
      svg: "<svg><text>Expanded diagram</text></svg>",
    });

    renderWithTheme(<MermaidCodeBlock code={"graph TD;\nA-->B;"} />);

    const openButton = await screen.findByTestId(
      "markdown-mermaid-open-viewer"
    );
    fireEvent.click(openButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByTestId("markdown-mermaid-viewer-svg")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("markdown-mermaid-close-viewer"));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
