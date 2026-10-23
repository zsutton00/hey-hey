import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { HtmlCssSectionEditor } from "../HtmlCssSectionEditor";

const definition = {
  key: "preview",
  label: "Preview",
  kind: "html/css" as const,
  defaultSizeKey: "desktop",
  sizeProfiles: [
    {
      key: "desktop",
      label: "Desktop",
      breakpoints: [
        {
          minContainerWidth: 0,
          inline: { width: 800, height: 600 },
          page: { width: 1200, height: 800 },
        },
      ],
    },
  ],
};

const content = {
  html: "<main>Preview</main>",
  css: "",
  sizeKey: "desktop",
  annotations: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      note: "Keep this visible.",
      author: {
        type: "human" as const,
        userId: "10000000-0000-4000-8000-000000000002",
      },
      category: "context" as const,
      lifecycle: "open" as const,
      authoredProposalId: "20000000-0000-4000-8000-000000000001",
      authoredSizeKey: "desktop",
      target: {
        type: "position" as const,
        x: 0.5,
        y: 0.5,
        sizeKey: "desktop",
      },
    },
  ],
};

describe("HtmlCssSectionEditor", () => {
  it("leads with the preview and keeps raw source collapsed by default", () => {
    render(
      <HtmlCssSectionEditor
        value={JSON.stringify(content)}
        onChange={vi.fn()}
        definition={definition}
        materializedProposalId={content.annotations[0].authoredProposalId}
        authorUserId={content.annotations[0].author.userId}
      />
    );

    expect(screen.queryByText("Add note")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("html-css-annotation-canvas")
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit html\/css source/i })
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps annotation controls hidden before materialization", () => {
    render(
      <HtmlCssSectionEditor
        value={JSON.stringify({ html: "<main>Draft</main>", css: "" })}
        onChange={vi.fn()}
        definition={definition}
        authorUserId={content.annotations[0].author.userId}
      />
    );

    expect(screen.queryByText("Add note")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("html-css-annotation-canvas")
    ).not.toBeInTheDocument();
  });

  it("preserves annotations when authored source changes", () => {
    const onChange = vi.fn();
    render(
      <HtmlCssSectionEditor
        value={JSON.stringify(content)}
        onChange={onChange}
        definition={definition}
        materializedProposalId={content.annotations[0].authoredProposalId}
        authorUserId={content.annotations[0].author.userId}
      />
    );

    fireEvent.change(screen.getByLabelText("HTML source"), {
      target: { value: "<main>Updated</main>" },
    });

    expect(JSON.parse(onChange.mock.calls[0][0])).toEqual({
      ...content,
      html: "<main>Updated</main>",
    });
  });

  it("does not expose annotation lifecycle or creation controls", () => {
    const onChange = vi.fn();
    render(
      <HtmlCssSectionEditor
        value={JSON.stringify(content)}
        onChange={onChange}
        definition={definition}
        materializedProposalId={content.annotations[0].authoredProposalId}
        authorUserId={content.annotations[0].author.userId}
      />
    );

    expect(
      screen.queryByRole("button", { name: "Expanded" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resolve annotation 1" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add positional note" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Add note")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not activate the element review bridge", () => {
    const onChange = vi.fn();
    render(
      <HtmlCssSectionEditor
        value={JSON.stringify(content)}
        onChange={onChange}
        definition={definition}
        materializedProposalId={content.annotations[0].authoredProposalId}
        authorUserId={content.annotations[0].author.userId}
      />
    );
    const frame = screen.getByTitle("Draft HTML/CSS mockup preview");
    const ordinaryDocument = frame.getAttribute("srcdoc");

    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toBe(ordinaryDocument);
    expect(
      screen.queryByRole("button", { name: "Add element note" })
    ).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
