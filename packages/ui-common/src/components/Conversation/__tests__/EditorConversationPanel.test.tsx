import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { EditorConversationPanel } from "../EditorConversationPanel";

const DraftEditor = () => {
  const [draft, setDraft] = useState("unsaved draft");
  return (
    <input
      aria-label="Draft"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
};

describe("EditorConversationPanel", () => {
  it("starts collapsed and gives the editor all space except the toggle rail", () => {
    render(
      <EditorConversationPanel
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );

    expect(screen.getByText("Chat body")).not.toBeVisible();
    expect(
      screen.getByRole("button", { name: "Expand conversation" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("editor-conversation-content")).toHaveStyle({
      flex: "1 1 auto",
    });
    expect(screen.getByTestId("editor-conversation-rail")).toHaveStyle({
      flex: "0 0 40px",
      maxWidth: "40px",
    });
  });

  it("toggles accessibly without resetting the mounted editor draft", async () => {
    const user = userEvent.setup();
    render(
      <EditorConversationPanel
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );
    const draft = screen.getByRole("textbox", { name: "Draft" });
    await user.clear(draft);
    await user.type(draft, "changed draft");

    await user.click(
      screen.getByRole("button", { name: "Expand conversation" }),
    );
    expect(screen.getByText("Chat body")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse conversation" }),
    ).toHaveAttribute("aria-expanded", "true");

    await user.click(
      screen.getByRole("button", { name: "Collapse conversation" }),
    );
    expect(screen.getByText("Chat body")).not.toBeVisible();
    expect(draft).toHaveValue("changed draft");
  });

  it("resets to collapsed when a new edit session mounts", async () => {
    const user = userEvent.setup();
    const first = render(
      <EditorConversationPanel
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Expand conversation" }),
    );
    first.unmount();

    render(
      <EditorConversationPanel
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );
    expect(screen.getByText("Chat body")).not.toBeVisible();
    expect(
      screen.getByRole("button", { name: "Expand conversation" }),
    ).toBeInTheDocument();
  });

  it("starts open when initiallyOpen is set", () => {
    render(
      <EditorConversationPanel
        initiallyOpen
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );

    expect(screen.getByText("Chat body")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Collapse conversation" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("stays closed once the user closes an initially open column", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <EditorConversationPanel
        initiallyOpen
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Collapse conversation" }),
    );
    rerender(
      <EditorConversationPanel
        initiallyOpen
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );

    expect(screen.getByText("Chat body")).not.toBeVisible();
    expect(
      screen.getByRole("button", { name: "Expand conversation" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("opens when initiallyOpen arrives after mount, until the user toggles", () => {
    const { rerender } = render(
      <EditorConversationPanel
        initiallyOpen={false}
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );
    expect(screen.getByText("Chat body")).not.toBeVisible();

    rerender(
      <EditorConversationPanel
        initiallyOpen
        leftContent={<DraftEditor />}
        rightContent={<div>Chat body</div>}
      />,
    );

    expect(screen.getByText("Chat body")).toBeVisible();
  });
});
