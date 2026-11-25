import { fireEvent, render, screen } from "@testing-library/react";
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

const input = () => screen.getByTestId("work-in-select");

const openList = () => {
  fireEvent.focus(input());
  fireEvent.mouseDown(input());
};

const typeInField = (text: string) => {
  fireEvent.focus(input());
  fireEvent.mouseDown(input());
  fireEvent.change(input(), { target: { value: text } });
};

const optionBranches = () =>
  screen
    .queryAllByTestId("work-in-option")
    .map((option) => `${option.dataset.branch} | ${option.dataset.tag}`);

describe("WorkInSelect", () => {
  it("is labelled Branch or worktree, defaults to the main folder's branch and is no wider than 280px", () => {
    renderSelect();

    expect(screen.getByLabelText("Branch or worktree")).toBe(input());
    expect(input()).toHaveValue("main · main folder");
    expect(input().closest(".MuiAutocomplete-root")).toHaveStyle({
      width: "280px",
    });
  });

  it("says when the main folder is detached", () => {
    renderSelect({
      entry: readyEntry({ mainFolder: { path: "/repo", branch: null } }),
    });

    expect(input()).toHaveValue("detached · main folder");
  });

  it("lists each branch once with nothing typed: Recent first, then Worktrees, no unmatched branch", () => {
    renderSelect({
      entry: readyEntry({ branchMatches: ["unrelated/branch"] }),
    });
    openList();

    expect(optionBranches()).toEqual([
      "main | main folder",
      "feature/a | worktree",
      "old-work | new worktree",
    ]);
    expect(screen.getByRole("listbox")).not.toHaveTextContent(
      "unrelated/branch",
    );
    expect(
      screen.getByTestId("work-in-option-detached-worktree"),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText("Other branch…")).toBeNull();
    expect(screen.queryByText("New worktree…")).toBeNull();
  });

  it("always offers the main folder's branch first, even when it was never recorded", () => {
    renderSelect({ entry: readyEntry({ recentBranches: [] }) });
    openList();

    expect(optionBranches()).toEqual([
      "main | main folder",
      "feature/a | worktree",
    ]);
  });

  it("maps picks to the same choices as before", () => {
    const { onChange } = renderSelect({
      value: {
        serviceId: SERVICE_ID,
        kind: "WORKTREE",
        branch: "old-work",
        newBranch: false,
      },
    });

    openList();
    fireEvent.click(screen.getAllByTestId("work-in-option")[0] as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith({
      serviceId: SERVICE_ID,
      kind: "MAIN_FOLDER",
    });

    openList();
    fireEvent.click(screen.getAllByTestId("work-in-option")[1] as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "feature/a",
      newBranch: false,
    });
  });

  it("maps a recent branch checked out nowhere to a worktree on that branch", () => {
    const { onChange } = renderSelect();

    openList();
    fireEvent.click(screen.getAllByTestId("work-in-option")[2] as HTMLElement);
    expect(onChange).toHaveBeenLastCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "old-work",
      newBranch: false,
    });
  });

  it("filters while typing and adds unmatched branches tagged as opening in a new worktree", () => {
    const { onChange, onBranchQueryChange } = renderSelect({
      entry: readyEntry({ branchMatches: ["fix/login", "feature/a"] }),
    });
    typeInField("F");

    expect(onBranchQueryChange).toHaveBeenCalledWith("F");
    expect(optionBranches()).toEqual([
      "feature/a | worktree",
      "fix/login | opens in a new worktree",
    ]);

    fireEvent.click(screen.getAllByTestId("work-in-option")[1] as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "fix/login",
      newBranch: false,
    });
  });

  it("says when nothing matches, and when the branch search failed or was cut off", () => {
    const view = renderSelect();
    typeInField("zzz");
    expect(screen.getByText("No matching branches.")).toBeInTheDocument();
    view.unmount();

    renderSelect({
      searchError: "machine offline",
      entry: readyEntry({
        branchMatches: ["fix/login"],
        branchMatchesTruncated: true,
      }),
    });
    typeInField("fix");
    expect(screen.getByTestId("work-in-search-error")).toHaveTextContent(
      "Branch search failed",
    );
    expect(screen.getByTestId("work-in-search-note")).toHaveTextContent(
      "Keep typing to narrow them.",
    );
  });

  it("notes that a branch checked out nowhere opens in its own worktree and leaves the main folder alone", () => {
    const { onChange } = renderSelect({
      value: {
        serviceId: SERVICE_ID,
        kind: "WORKTREE",
        branch: "old-work",
        newBranch: false,
      },
    });

    expect(screen.getByTestId("work-in-new-worktree-note")).toHaveTextContent(
      "old-work isn't checked out anywhere. It will open in its own new worktree, so your main folder stays on main.",
    );
    expect(input()).toHaveValue("old-work · new worktree");

    fireEvent.click(screen.getByTestId("work-in-open-as-worktree"));
    expect(onChange).toHaveBeenCalledWith({
      serviceId: SERVICE_ID,
      kind: "WORKTREE",
      branch: "old-work",
      newBranch: false,
    });
  });

  it("creates a new worktree from the button beside the field", () => {
    const { onChange } = renderSelect();

    fireEvent.click(screen.getByTestId("work-in-new-worktree-button"));
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

  it("warns when a worktree is chosen on the branch the main folder holds", () => {
    renderSelect({
      value: {
        serviceId: SERVICE_ID,
        kind: "WORKTREE",
        branch: "main",
        newBranch: true,
      },
    });

    expect(screen.getByTestId("work-in-conflict")).toBeInTheDocument();
    expect(input()).toHaveValue("main · new worktree");
  });

  it("asks for a choice when one is required and none is made", () => {
    renderSelect({ requireChoice: true });

    expect(input()).toHaveValue("");
    expect(input()).toHaveAttribute("placeholder", "Choose where to work");
  });

  it("shows a Plan's branch instead of the field and cannot be changed", () => {
    renderSelect({ lockedBranch: "plan/stage-1" });

    expect(screen.getByRole("textbox")).toHaveValue(
      "Plan branch: plan/stage-1",
    );
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.queryByTestId("work-in-select")).toBeNull();
    expect(screen.queryByTestId("work-in-new-worktree-button")).toBeNull();
  });

  it("shows a Service's read error in place", () => {
    renderSelect({
      entry: { status: "error", message: "Not a git repository" },
    });

    expect(screen.getByTestId("work-in-error")).toHaveTextContent(
      "Not a git repository",
    );
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
