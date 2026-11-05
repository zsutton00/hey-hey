import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectHintsSubtab } from "./ProjectHintsSubtab";

const mocks = vi.hoisted(() => ({ hints: vi.fn(), types: vi.fn() }));
vi.mock("@hey-hey/ui-common/data", () => ({
  useAdminProjectHints: mocks.hints,
  useWorkItemTypes: mocks.types,
}));
vi.mock("@hey-hey/ui-common", () => ({
  EntityLinkWithPreview: ({ label }: { label: string }) => <span>{label}</span>,
}));

const result = (over: object = {}) => ({
  hints: [],
  matchingCount: 0,
  totalCount: 0,
  isLoading: false,
  error: null,
  ...over,
});

const renderSubtab = (searchParams = "") =>
  render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <ProjectHintsSubtab organizationId="organization" projectId="project" />
    </NuqsTestingAdapter>,
  );

describe("ProjectHintsSubtab", () => {
  beforeEach(() => {
    mocks.hints.mockReturnValue(result());
    mocks.types.mockReturnValue({
      workItemTypes: [
        { definition: { key: "FEATURE", name: "Feature" } },
        { definition: { key: "mockup", name: "Mockup" } },
      ],
    });
  });

  it("shows full hint text, connected titles with item types, muted unavailable rows and strengths, read-only", () => {
    const text = "Use the shared helper.\nPreserve the complete note.";
    mocks.hints.mockReturnValue(
      result({
        matchingCount: 1,
        totalCount: 4,
        hints: [
          {
            id: "hint",
            text,
            connections: [
              {
                id: "c1",
                targetNodeId: "a",
                targetEntityType: "TASK",
                strength: 2.5,
                title: "Live Updates",
                itemType: "FEATURE",
              },
              {
                id: "c2",
                targetNodeId: "b",
                targetEntityType: "TASK",
                strength: 1,
              },
            ],
          },
        ],
      }),
    );
    renderSubtab();

    expect(screen.getByText(/Use the shared helper/).textContent).toBe(text);
    expect(screen.getByText("Live Updates")).toBeInTheDocument();
    expect(screen.getByText("Feature")).toBeInTheDocument();
    expect(screen.getByText(/strength 2.5/)).toBeInTheDocument();
    expect(screen.getByText("Connected item unavailable")).toBeInTheDocument();
    expect(screen.getByText(/strength 1$/)).toBeInTheDocument();
    expect(screen.getByTestId("project-admin-hints-count")).toHaveTextContent(
      "1 of 4 hints",
    );
    expect(screen.queryByText("Implementation hints")).not.toBeInTheDocument();
  });

  it("restores filters from the URL, passes them to the listing and clears them", async () => {
    renderSubtab("?hintSearch=api&hintTypes=FEATURE&hintMinStrength=2");

    expect(mocks.hints).toHaveBeenLastCalledWith("organization", "project", {
      search: "api",
      itemTypes: ["FEATURE"],
      minStrength: 2,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Clear filters" }),
    );

    expect(mocks.hints).toHaveBeenLastCalledWith("organization", "project", {
      search: "",
      itemTypes: [],
      minStrength: undefined,
    });
    expect(
      screen.queryByRole("button", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
  });

  it("tells an empty project from a filter with no matches", () => {
    renderSubtab();
    expect(
      screen.getByText("This project has no live Hints."),
    ).toBeInTheDocument();
  });

  it("says when filters match nothing", () => {
    mocks.hints.mockReturnValue(result({ totalCount: 3 }));
    renderSubtab();
    expect(
      screen.getByText("No hints match these filters."),
    ).toBeInTheDocument();
  });

  it("surfaces listing failures", () => {
    mocks.hints.mockReturnValue(
      result({ error: new Error("Graph unavailable") }),
    );
    renderSubtab();
    expect(screen.getByRole("alert")).toHaveTextContent("Graph unavailable");
  });
});
