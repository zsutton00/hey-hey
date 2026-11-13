import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { TaskPreviewCard } from "../TaskPreviewCard";

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({
    children,
    sx,
  }: {
    children: React.ReactNode;
    sx: Record<string, string | number>;
  }) => (
    <div data-testid="markdown" data-sx={JSON.stringify(sx)}>
      {children}
    </div>
  ),
}));

const task: TaskResponseDto = {
  id: "task-1",
  name: "Readable task preview",
  type: "STANDARD",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Backlog,
  source: TaskSource.System,
  sections: [
    {
      id: "description",
      key: "description",
      order: 0,
      materializedMarkdown: "Description text",
      materializedProposalId: "proposal-1",
    },
    {
      id: "acceptance-criteria",
      key: "acceptanceCriteria",
      order: 1,
      materializedMarkdown: "Acceptance criteria text",
      materializedProposalId: "proposal-1",
    },
  ],
};

describe("TaskPreviewCard", () => {
  it("uses the same readable typography for every task-content section", () => {
    const markup = renderToStaticMarkup(
      <TaskPreviewCard task={task} defaultExpanded collapseOnEscape={false} />,
    );

    expect(markup).toContain("Description text");
    expect(markup).toContain("Acceptance criteria text");
    expect(markup.match(/data-testid="markdown"/g)).toHaveLength(2);
    expect(
      markup.match(/&quot;maxWidth&quot;:&quot;100ch&quot;/g),
    ).toHaveLength(2);
    expect(markup.match(/&quot;lineHeight&quot;:1.6/g)).toHaveLength(2);
    expect(
      markup.match(/&quot;fontSize&quot;:&quot;1.1rem&quot;/g),
    ).toHaveLength(2);
  });
});

describe("TaskPreviewCard Escape handling", () => {
  it("collapses an expanded card on Escape when the caller opts in", () => {
    render(<TaskPreviewCard task={task} collapseOnEscape />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("button", { name: "expand" })).toBeTruthy();
  });

  it("keeps an expanded card open on Escape when the caller does not opt in", () => {
    render(<TaskPreviewCard task={task} collapseOnEscape={false} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("button", { name: "collapse" })).toBeTruthy();
  });

  it("ignores an Escape that another handler already consumed", () => {
    const consumeEscape = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", consumeEscape);
    render(<TaskPreviewCard task={task} collapseOnEscape />);

    fireEvent.keyDown(window, { key: "Escape" });
    window.removeEventListener("keydown", consumeEscape);

    expect(screen.getByRole("button", { name: "collapse" })).toBeTruthy();
  });
});
