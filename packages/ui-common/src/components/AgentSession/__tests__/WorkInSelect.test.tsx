import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  const release = vi.fn();
  const registerOpenNameField = vi.fn(() => release);
  const props: WorkInSelectProps = {
    serviceId: SERVICE_ID,
    entry: readyEntry(),
    value: null,
    lockedBranch: null,
    searching: false,
    searchError: null,
    disabled: false,
    suggestBranchName: null,
    branchNameServiceIds: [SERVICE_ID],
    registerOpenNameField,
    onBranchQueryChange,
    onChange,
    ...overrides,
  };
  const view = render(<WorkInSelect {...props} />);

  return {
    ...view,
    props,
    onChange,
    onBranchQueryChange,
    registerOpenNameField,
    release,
  };
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

const nameField = () => screen.getByTestId("work-in-new-input");

const openNameField = () =>
  fireEvent.click(screen.getByTestId("work-in-new-worktree-button"));

const cancelButton = () => screen.getByRole("button", { name: "Cancel" });

const acceptButton = () => screen.getByRole("button", { name: "Accept" });

describe("WorkInSelect, naming a new worktree", () => {
  it("replaces the field and its button with one naming row", () => {
    const { onChange } = renderSelect({
      value: {
        serviceId: SERVICE_ID,
        kind: "WORKTREE",
        branch: "old-work",
        newBranch: false,
      },
    });
    openNameField();

    expect(screen.getByLabelText("New branch from main")).toBe(nameField());
    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveValue("");
    expect(acceptButton()).toBeDisabled();
    expect(screen.queryByTestId("work-in-select")).toBeNull();
    expect(screen.queryByTestId("work-in-new-worktree-button")).toBeNull();
    // The note describes the earlier choice, which is out of sight.
    expect(screen.queryByTestId("work-in-new-worktree-note")).toBeNull();
    expect(screen.queryByText(/Starts from/)).toBeNull();
    expect(screen.queryByText("Use new worktree")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says the branch starts from the current commit while the main folder is detached", () => {
    renderSelect({
      entry: readyEntry({ mainFolder: { path: "/repo", branch: null } }),
    });
    openNameField();

    expect(screen.getByLabelText("New branch from current commit")).toBe(
      nameField(),
    );
  });

  it("Cancel brings the earlier choice back unchanged and releases the hold", () => {
    const view = renderSelect({ requireChoice: true });
    openNameField();
    expect(view.registerOpenNameField).toHaveBeenCalledTimes(1);
    expect(view.release).not.toHaveBeenCalled();

    fireEvent.change(nameField(), { target: { value: "abandoned" } });
    fireEvent.click(cancelButton());

    expect(view.onChange).not.toHaveBeenCalled();
    expect(view.release).toHaveBeenCalledTimes(1);
    expect(input()).toHaveValue("");
    expect(screen.getByTestId("work-in-new-worktree-button")).toHaveFocus();
  });

  it("Accept sends a new-branch worktree choice that the field then shows", () => {
    const view = renderSelect();
    openNameField();
    fireEvent.change(nameField(), { target: { value: "  my-branch  " } });
    fireEvent.click(acceptButton());

    const choice = {
      serviceId: SERVICE_ID,
      kind: "WORKTREE" as const,
      branch: "my-branch",
      newBranch: true,
    };
    expect(view.onChange).toHaveBeenCalledWith(choice);
    expect(view.release).toHaveBeenCalledTimes(1);

    view.rerender(<WorkInSelect {...view.props} value={choice} />);
    expect(input()).toHaveValue("my-branch · new worktree");
  });

  it("accepts on Enter alone and cancels on Escape without it reaching a surrounding dialog", async () => {
    const onOuterKeyDown = vi.fn();
    const onChange = vi.fn();
    render(
      <div onKeyDown={(event) => onOuterKeyDown(event.key)}>
        <WorkInSelect
          serviceId={SERVICE_ID}
          entry={readyEntry()}
          value={null}
          lockedBranch={null}
          searching={false}
          searchError={null}
          disabled={false}
          suggestBranchName={null}
          branchNameServiceIds={[SERVICE_ID]}
          registerOpenNameField={() => () => undefined}
          onBranchQueryChange={() => undefined}
          onChange={onChange}
        />
      </div>,
    );
    const user = userEvent.setup();

    await user.click(screen.getByTestId("work-in-new-worktree-button"));
    await user.keyboard("typed{Escape}");
    expect(onOuterKeyDown).not.toHaveBeenCalledWith("Escape");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("work-in-new-worktree-button")).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard("my-branch");
    await user.keyboard("{Meta>}{Enter}{/Meta}{Shift>}{Enter}{/Shift}");
    fireEvent.keyDown(nameField(), { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "my-branch", newBranch: true }),
    );
    // The same key press must not reopen the field through the focused button.
    expect(screen.queryByTestId("work-in-new")).toBeNull();
  });

  it("pre-fills the suggested name, checked against every Service it applies to", async () => {
    const suggestBranchName = vi.fn(async () => "fix-the-pairing-poll-2");
    renderSelect({
      suggestBranchName,
      branchNameServiceIds: [SERVICE_ID, "service-2"],
    });
    openNameField();

    expect(nameField()).toHaveAttribute("placeholder", "Checking names…");
    await screen.findByDisplayValue("fix-the-pairing-poll-2");
    expect(suggestBranchName).toHaveBeenCalledWith([SERVICE_ID, "service-2"]);
    expect(acceptButton()).toBeEnabled();
  });

  it.each(["my own name", ""])(
    "never replaces what the user typed (%j) with a late suggestion",
    async (typedText) => {
      let answer: (name: string) => void = () => undefined;
      renderSelect({
        suggestBranchName: () =>
          new Promise<string>((resolve) => {
            answer = resolve;
          }),
      });
      openNameField();
      fireEvent.change(nameField(), { target: { value: "x" } });
      fireEvent.change(nameField(), { target: { value: typedText } });

      await act(async () => answer("late-suggestion"));

      expect(nameField()).toHaveValue(typedText);
    },
  );

  it("releases the hold when a Plan's branch replaces an open name field", () => {
    const view = renderSelect();
    openNameField();

    view.rerender(<WorkInSelect {...view.props} lockedBranch="plan/stage-1" />);

    expect(view.release).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toHaveValue(
      "Plan branch: plan/stage-1",
    );
  });
});
