import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkInSelect, type WorkInSelectProps } from "../WorkInSelect";
import { resolveChoice } from "../resolveChoice";
import type { ServicePlacesEntry } from "../runtime/hooks/useServicePlaces";

const SERVICE_ID = "service-1";

const readyEntry = (
  overrides: Partial<Extract<ServicePlacesEntry, { status: "ready" }>> = {},
): ServicePlacesEntry => ({
  status: "ready",
  mainFolder: { path: "/repo", branch: "main" },
  worktrees: [
    { branch: "feature/a", worktreePath: "/repo/.worktrees/a" },
    { branch: null, worktreePath: "/repo/.worktrees/detached" },
  ],
  recentBranches: [
    {
      branch: "feature/a",
      kind: "WORKTREE",
      lastRecordedAt: "2026-11-01T00:00:00Z",
    },
    {
      branch: "old-work",
      kind: "WORKTREE",
      lastRecordedAt: "2026-10-01T00:00:00Z",
    },
    {
      branch: "main",
      kind: "MAIN_FOLDER",
      lastRecordedAt: "2026-09-01T00:00:00Z",
    },
  ],
  branchMatches: [],
  branchMatchesTruncated: false,
  ...overrides,
});

const renderSelect = (overrides: Partial<WorkInSelectProps> = {}) => {
  const onChange = vi.fn();
  const onBranchQueryChange = vi.fn();
  const props: WorkInSelectProps = {
    serviceId: SERVICE_ID,
    entry: readyEntry(),
    value: null,
    lockedBranch: null,
    branchQuery: "",
    searching: false,
    searchError: null,
    disabled: false,
    onBranchQueryChange,
    onChange,
    ...overrides,
  };
  const view = render(<WorkInSelect {...props} />);

  return { ...view, onChange, onBranchQueryChange };
};

const openList = () => {
  fireEvent.mouseDown(
    within(screen.getByTestId("work-in-select")).getByRole("combobox"),
  );
};

describe("WorkInSelect", () => {
  it("defaults to the main folder's current branch", () => {
    renderSelect();

    expect(screen.getByTestId("work-in-select")).toHaveTextContent(
      "Current: main (main folder)",
    );
  });

  it("says when the main folder is detached", () => {
    renderSelect({
      entry: readyEntry({ mainFolder: { path: "/repo", branch: null } }),
    });

    expect(screen.getByTestId("work-in-select")).toHaveTextContent(
      "Current: detached (main folder)",
    );
  });

  it("lists Current, Worktrees, Recently used here, Other branch…, New worktree… in order and marks branches with no worktree", () => {
    renderSelect();
    openList();

    const listbox = screen.getByRole("listbox");
    const text = listbox.textContent ?? "";
    const order = [
      "Current",
      "Worktrees",
      "Recently used here",
      "Other branch…",
      "New worktree…",
    ].map((label) => text.indexOf(label));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("old-work (no worktree)");
    expect(
      screen.getByTestId("work-in-option-detached-worktree"),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("maps each group to a choice", () => {
    const { onChange } = renderSelect({
      value: {
        serviceId: SERVICE_ID,
        kind: "WORKTREE",
        branch: "old-work",
        newBranch: false,
      },
    });

    openList();
    fireEvent.click(screen.getByTestId("work-in-option-current"));
    expect(onChange).toHaveBeenLastCalledWith({
      serviceId: SERVICE_ID,
      kind: "MAIN_FOLDER",
    });

    openList();
    fireEvent.click(screen.getByTestId("work-in-option-worktree"));
    expect(onChange).toHaveBeenLastCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "feature/a",
      newBranch: false,
    });

    // A recent branch the main folder has checked out stays in the main folder.
    openList();
    fireEvent.click(
      screen.getAllByTestId("work-in-option-recent")[2] as HTMLElement,
    );
    expect(onChange).toHaveBeenLastCalledWith({
      serviceId: SERVICE_ID,
      kind: "MAIN_FOLDER",
    });
  });

  it("maps a recent branch with no worktree to a worktree on that branch", () => {
    const { onChange } = renderSelect();
    openList();
    fireEvent.click(
      screen.getAllByTestId("work-in-option-recent")[1] as HTMLElement,
    );
    expect(onChange).toHaveBeenLastCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "old-work",
      newBranch: false,
    });
  });

  it("shows other branches only after typing a search", () => {
    const { onChange, onBranchQueryChange, rerender } = renderSelect();
    openList();
    fireEvent.click(screen.getByTestId("work-in-option-other"));

    expect(screen.queryByTestId("work-in-search-results")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "fix" } });
    expect(onBranchQueryChange).toHaveBeenCalledWith("fix");

    rerender(
      <WorkInSelect
        serviceId={SERVICE_ID}
        entry={readyEntry({ branchMatches: ["fix/login"] })}
        value={null}
        lockedBranch={null}
        branchQuery="fix"
        searching={false}
        searchError={null}
        disabled={false}
        onBranchQueryChange={onBranchQueryChange}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("work-in-search-result"));

    expect(onChange).toHaveBeenCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "fix/login",
      newBranch: false,
    });
  });

  it("notes that a branch checked out nowhere opens in its own worktree", () => {
    renderSelect({
      value: {
        serviceId: SERVICE_ID,
        kind: "WORKTREE",
        branch: "old-work",
        newBranch: false,
      },
    });

    expect(screen.getByTestId("work-in-new-worktree-note")).toHaveTextContent(
      "opens in its own new worktree",
    );
  });

  it("asks for a name for a new worktree, starting from the main folder's branch", () => {
    const { onChange } = renderSelect();
    openList();
    fireEvent.click(screen.getByTestId("work-in-option-new"));

    expect(screen.getByTestId("work-in-new")).toHaveTextContent(
      "Starts from main",
    );
    expect(screen.getByTestId("work-in-new-confirm")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("New branch name"), {
      target: { value: "my-branch" },
    });
    fireEvent.click(screen.getByTestId("work-in-new-confirm"));

    expect(onChange).toHaveBeenCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "my-branch",
      newBranch: true,
    });
  });

  it("shows a Plan's branch instead of the list and cannot be changed", () => {
    renderSelect({ lockedBranch: "plan/stage-1" });

    expect(screen.getByRole("textbox")).toHaveValue(
      "Plan branch: plan/stage-1",
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.queryByTestId("work-in-select")).toBeNull();
  });

  it("shows a Service's read error in place", () => {
    renderSelect({
      entry: { status: "error", message: "Not a git repository" },
    });

    expect(screen.getByTestId("work-in-error")).toHaveTextContent(
      "Not a git repository",
    );
  });

  it("shows an empty search as no matches", () => {
    renderSelect({ branchQuery: "zzz" });
    openList();
    fireEvent.click(screen.getByTestId("work-in-option-other"));

    expect(screen.getByTestId("work-in-search-results")).toHaveTextContent(
      "No matching branches.",
    );
    expect(screen.queryByTestId("work-in-search-error")).toBeNull();
  });

  it("says when the branch search failed instead of showing an empty list", () => {
    renderSelect({ branchQuery: "fix", searchError: "machine offline" });
    openList();
    fireEvent.click(screen.getByTestId("work-in-option-other"));

    expect(screen.getByTestId("work-in-search-error")).toHaveTextContent(
      "Branch search failed",
    );
    expect(screen.queryByText("No matching branches.")).toBeNull();
  });

  it("keeps a branch picked from search a valid value without a console warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    renderSelect({
      value: {
        serviceId: SERVICE_ID,
        kind: "WORKTREE",
        branch: "fix/login",
        newBranch: false,
      },
    });

    expect(screen.getByTestId("work-in-select")).toHaveTextContent("fix/login");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    warn.mockRestore();
    error.mockRestore();
  });

  it("maps a search result that matches an existing worktree to that worktree", () => {
    const { onChange } = renderSelect({
      branchQuery: "feature",
      entry: readyEntry({ branchMatches: ["feature/a"] }),
    });
    openList();
    fireEvent.click(screen.getByTestId("work-in-option-other"));
    fireEvent.click(screen.getByTestId("work-in-search-result"));

    expect(onChange).toHaveBeenCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "feature/a",
      newBranch: false,
    });
  });

  it("picks a worktree from the list while the value is still the default", () => {
    const { onChange } = renderSelect({ value: null });
    openList();
    fireEvent.click(screen.getByTestId("work-in-option-worktree"));

    expect(onChange).toHaveBeenCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "feature/a",
      newBranch: false,
    });
  });

  it("resolves the default to the main folder and keeps an explicit choice", () => {
    const explicit = {
      serviceId: SERVICE_ID,
      kind: "WORKTREE" as const,
      branch: "x",
      newBranch: false,
    };

    expect(resolveChoice(SERVICE_ID, null)).toEqual({
      serviceId: SERVICE_ID,
      kind: "MAIN_FOLDER",
    });
    expect(resolveChoice(SERVICE_ID, explicit)).toBe(explicit);
  });
});
