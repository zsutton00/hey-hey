import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHintsSubtab } from "./ProjectHintsSubtab";

const mocks = vi.hoisted(() => ({ hints: vi.fn(), names: vi.fn() }));
vi.mock("@hey-hey/ui-common/data", () => ({
  useAdminProjectHints: mocks.hints,
  useEntityNames: mocks.names,
}));
vi.mock("@hey-hey/ui-common", () => ({
  EntityLinkWithPreview: ({ label }: { label: string }) => <span>{label}</span>,
}));

describe("ProjectHintsSubtab", () => {
  beforeEach(() => {
    mocks.hints.mockReturnValue({ hints: [], isLoading: false, error: null });
    mocks.names.mockReturnValue({
      names: new Map(),
      isLoading: false,
      error: null,
    });
  });
  it("shows full graph hint text, connected names and strengths with no editing controls", () => {
    const text = "Use the shared helper.\nPreserve the complete note.";
    mocks.hints.mockReturnValue({
      hints: [
        {
          id: "hint",
          text,
          connections: [
            {
              id: "connection",
              targetNodeId: "task",
              targetEntityType: "TASK",
              strength: 2.5,
            },
          ],
        },
      ],
      isLoading: false,
      error: null,
    });
    mocks.names.mockReturnValue({
      names: new Map([["TASK:task", "Live Updates"]]),
      isLoading: false,
      error: null,
    });
    render(
      <ProjectHintsSubtab organizationId="organization" projectId="project" />,
    );
    expect(mocks.hints).toHaveBeenCalledWith("organization", "project");
    expect(screen.getByText(/Use the shared helper/).textContent).toBe(text);
    expect(screen.getByText("Live Updates")).toBeInTheDocument();
    expect(screen.getByText(/strength 2.5/)).toBeInTheDocument();
    expect(screen.queryByText("Implementation hints")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("shows the empty state", () => {
    render(
      <ProjectHintsSubtab organizationId="organization" projectId="project" />,
    );
    expect(
      screen.getByText("This project has no live Hints."),
    ).toBeInTheDocument();
  });
  it("surfaces listing failures", () => {
    mocks.hints.mockReturnValue({
      hints: [],
      isLoading: false,
      error: new Error("Graph unavailable"),
    });
    render(
      <ProjectHintsSubtab organizationId="organization" projectId="project" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Graph unavailable");
  });
});
