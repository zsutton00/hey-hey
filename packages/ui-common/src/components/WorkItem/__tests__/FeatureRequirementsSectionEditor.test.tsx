import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import type { FeatureRequirementRecord } from "../../../api";
import { serializeFeatureRequirementsSection } from "../../../utils/featureRequirementsEditing";
import { readFeatureRequirementsSection } from "../../../utils/featureRequirementsSection";
import type { SearchEntity } from "../../SmarterTextAreaCard/types";
import {
  FeatureRequirementsSectionEditor,
  type FeatureRequirementsEditorContext,
} from "../FeatureRequirementsSectionEditor";

vi.mock("../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({
    mention,
  }: {
    mention: { entityType: string; entityId: string; entityName: string };
  }) => (
    <span
      data-testid="mention-badge"
      data-entity-type={mention.entityType}
      data-entity-id={mention.entityId}
    >
      {mention.entityName}
    </span>
  ),
}));

const uuid = (last: string): string =>
  `00000000-0000-4000-8000-00000000000${last}`;

const record = (
  id: string,
  statement: string,
  group?: string,
): FeatureRequirementRecord => ({
  id,
  statement,
  ...(group === undefined ? {} : { group }),
  designedBy: [],
  fulfilledBy: [],
  contracts: [],
});

const FEATURE_ID = uuid("a");
const PARENT_ID = uuid("b");

const renderEditor = (
  initial: readonly FeatureRequirementRecord[],
  search: FeatureRequirementsEditorContext["onSearchEntities"] = async () => [],
  disabled = false,
) => {
  const changes: FeatureRequirementRecord[][] = [];
  const Harness: React.FC = () => {
    const [value, setValue] = useState(
      initial.length ? serializeFeatureRequirementsSection(initial) : "",
    );
    return (
      <FeatureRequirementsSectionEditor
        value={value}
        onChange={(next) => {
          const state = readFeatureRequirementsSection(next);
          changes.push(
            state.status === "valid" || state.status === "valid-empty"
              ? [...state.records]
              : [],
          );
          setValue(next);
        }}
        disabled={disabled}
        context={{
          organizationId: "org",
          projectId: "project",
          featureId: FEATURE_ID,
          parentId: PARENT_ID,
          onSearchEntities: search,
        }}
      />
    );
  };
  render(
    <ThemeProvider theme={createTheme()}>
      <Harness />
    </ThemeProvider>,
  );
  return { latest: () => changes.at(-1) ?? [...initial], changes };
};

describe("FeatureRequirementsSectionEditor", () => {
  it("adds, edits, and deletes requirements while keeping identity", () => {
    const { latest } = renderEditor([record(uuid("1"), "One")]);

    fireEvent.click(screen.getByTestId("requirements-editor-add"));
    const added = latest();
    expect(added).toHaveLength(2);
    expect(added[1]).toMatchObject({ statement: "" });

    const inputs = screen.getAllByTestId("requirement-statement-input");
    fireEvent.change(inputs[0], { target: { value: "One edited" } });
    expect(latest()[0]).toEqual({ ...record(uuid("1"), "One edited") });
    expect(latest()[1].id).toBe(added[1].id);

    fireEvent.click(screen.getAllByTestId("requirement-delete")[0]);
    expect(latest().map((r) => r.id)).toEqual([added[1].id]);
  });

  it("moves a requirement to a new group without changing its id", () => {
    const { latest } = renderEditor([
      record(uuid("1"), "One"),
      record(uuid("2"), "Two"),
    ]);
    fireEvent.mouseDown(screen.getAllByRole("combobox", { name: "Group" })[1]);
    fireEvent.click(screen.getByRole("option", { name: "New group…" }));
    expect(latest()).toEqual([
      record(uuid("2"), "Two", "Group 1"),
      record(uuid("1"), "One"),
    ]);
  });

  it("renames a group in place", () => {
    const { latest } = renderEditor([
      record(uuid("1"), "One", "Alpha"),
      record(uuid("2"), "Two", "Alpha"),
    ]);
    fireEvent.click(screen.getByTestId("requirement-group-rename"));
    const input = screen.getByTestId("requirement-group-name-input");
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Core" } });
    fireEvent.blur(input);
    expect(latest().map((r) => r.group)).toEqual(["Core", "Core"]);

    fireEvent.click(screen.getByTestId("requirement-group-name"));
    const renamed = screen.getByTestId("requirement-group-name-input");
    fireEvent.change(renamed, { target: { value: "not valid!" } });
    fireEvent.blur(renamed);
    expect(
      screen.queryByTestId("requirement-group-name-input"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("requirement-group-name")).toHaveTextContent(
      "Core",
    );
    expect(latest().map((r) => r.group)).toEqual(["Core", "Core"]);
  });

  it("keeps pickers visible below three records without an ungrouped heading", () => {
    renderEditor([record(uuid("1"), "One", "Alpha"), record(uuid("2"), "Two")]);
    expect(screen.queryByText("Not in a group")).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: "Group" })).toHaveLength(2);
    expect(screen.getAllByTestId("requirement-footer")).toHaveLength(2);
    expect(screen.queryByText("Move to new group")).not.toBeInTheDocument();
  });

  it("groups an ungrouped requirement from the picker without warning text", () => {
    const { latest } = renderEditor([
      record(uuid("1"), "One", "Alpha"),
      record(uuid("2"), "Two", "Alpha"),
      record(uuid("3"), "Three"),
    ]);
    const area = screen.getByTestId("requirements-editor-ungrouped");
    expect(within(area).getByText("Not in a group")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    expect(
      within(area).getByRole("combobox", { name: "Group" }),
    ).toHaveTextContent("Choose…");
    expect(
      getComputedStyle(
        screen.getByTestId("requirements-editor-ungrouped-container"),
      ).borderStyle,
    ).not.toBe("solid");
    fireEvent.mouseDown(within(area).getByRole("combobox", { name: "Group" }));
    fireEvent.click(screen.getByRole("option", { name: "Alpha" }));
    expect(latest()).toEqual([
      record(uuid("1"), "One", "Alpha"),
      record(uuid("2"), "Two", "Alpha"),
      record(uuid("3"), "Three", "Alpha"),
    ]);
  });

  it("moves grouped records through existing and unique new groups preserving all fields", () => {
    const cited = {
      ...record(uuid("1"), "One", "Alpha"),
      fulfilledBy: [
        {
          entityType: "TASK" as const,
          entityId: uuid("c"),
          entityTitle: "Build",
        },
      ],
    };
    const initial = [
      cited,
      record(uuid("2"), "Two", "Alpha"),
      record(uuid("3"), "Three", "Group 1"),
    ];
    const { latest, changes } = renderEditor(initial);
    const row = () =>
      screen
        .getAllByTestId("requirement-editor-row")
        .find((el) => el.dataset.requirementId === cited.id)!;
    fireEvent.mouseDown(within(row()).getByRole("combobox", { name: "Group" }));
    fireEvent.click(screen.getByRole("option", { name: "Alpha" }));
    expect(changes).toHaveLength(0);
    fireEvent.mouseDown(within(row()).getByRole("combobox", { name: "Group" }));
    fireEvent.click(screen.getByRole("option", { name: "Group 1" }));
    expect(latest().find((r) => r.id === cited.id)).toEqual({
      ...cited,
      group: "Group 1",
    });
    expect(latest().filter((r) => r.id !== cited.id)).toEqual(initial.slice(1));
    fireEvent.mouseDown(within(row()).getByRole("combobox", { name: "Group" }));
    fireEvent.click(screen.getByRole("option", { name: "New group…" }));
    expect(latest().find((r) => r.id === cited.id)).toEqual({
      ...cited,
      group: "Group 2",
    });
    expect(
      within(row()).getByRole("combobox", { name: "Group" }),
    ).toHaveTextContent("Group 2");
    fireEvent.click(within(row()).getByTestId("requirement-delete"));
    expect(latest()).toEqual(initial.slice(1));
  });

  it("commits rename on Enter, rejects duplicate/empty names and cancels on Escape", () => {
    const initial = [
      record(uuid("1"), "One", "Alpha"),
      record(uuid("2"), "Two", "Beta"),
    ];
    const { latest, changes } = renderEditor(initial);
    const open = () => {
      fireEvent.click(screen.getAllByTestId("requirement-group-name")[0]);
      const input = screen.getByTestId("requirement-group-name-input");
      expect(input).toHaveFocus();
      return input;
    };
    for (const value of ["Beta", ""]) {
      const input = open();
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(latest()).toEqual(initial);
    }
    const cancelled = open();
    fireEvent.change(cancelled, { target: { value: "Core" } });
    fireEvent.keyDown(cancelled, { key: "Escape" });
    expect(changes).toHaveLength(0);
    expect(
      screen.queryByTestId("requirement-group-name-input"),
    ).not.toBeInTheDocument();
    const input = open();
    fireEvent.change(input, { target: { value: " Core " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(latest()).toEqual([{ ...initial[0], group: "Core" }, initial[1]]);
  });

  it("disables group, rename, delete and drag controls when editing is disabled", () => {
    const { changes } = renderEditor(
      [record(uuid("1"), "One", "Alpha"), record(uuid("2"), "Two")],
      undefined,
      true,
    );
    for (const id of [
      "requirement-group-name",
      "requirement-group-rename",
      "requirement-delete",
      "requirement-drag-handle",
    ]) {
      for (const control of screen.getAllByTestId(id)) {
        expect(control).toBeDisabled();
        fireEvent.click(control);
      }
    }
    for (const picker of screen.getAllByRole("combobox", { name: "Group" }))
      expect(picker).toHaveAttribute("aria-disabled", "true");
    expect(changes).toHaveLength(0);
    expect(
      screen.queryByTestId("requirement-group-name-input"),
    ).not.toBeInTheDocument();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["drop", "cancel", "departure"] as const)(
    "highlights named destinations over the box and child row, then cleans up on %s",
    async (ending) => {
      class TestPointerEvent extends MouseEvent {
        pointerId = 1;
        isPrimary = true;
        pointerType = "mouse";
      }
      vi.stubGlobal("PointerEvent", TestPointerEvent);
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect",
      ).mockImplementation(function (this: HTMLElement) {
        const row = this.closest('[data-testid="requirement-editor-row"]');
        const group = this.closest('[data-testid="requirements-editor-group"]');
        const beta = group?.getAttribute("data-requirement-group") === "Beta";
        const top = row ? (beta ? 240 : 40) : beta ? 160 : 0;
        const height = row ? 60 : 160;
        return {
          x: 0,
          y: top,
          top,
          left: 0,
          right: 400,
          bottom: top + height,
          width: 400,
          height,
          toJSON: () => ({}),
        };
      });
      const initial = [
        record(uuid("1"), "One", "Alpha"),
        record(uuid("2"), "Two", "Beta"),
      ];
      const { latest, changes } = renderEditor(initial);
      const groups = screen.getAllByTestId("requirements-editor-group");
      expect(groups[0]).toHaveStyle({ borderStyle: "solid" });
      expect(groups[1]).toHaveStyle({ borderStyle: "solid" });
      const handle = screen.getAllByTestId("requirement-drag-handle")[0];
      fireEvent.pointerDown(handle, { clientX: 20, clientY: 50, button: 0 });
      fireEvent.pointerMove(document, { clientX: 20, clientY: 60 });
      fireEvent.pointerMove(document, { clientX: 20, clientY: 190 });
      await waitFor(() =>
        expect(groups[1]).toHaveAttribute("data-drop-target", "true"),
      );
      expect(groups[1]).toHaveStyle({ borderStyle: "dashed" });
      expect(groups[1]).toHaveStyle({
        backgroundColor: "rgba(25, 118, 210, 0.08)",
      });
      fireEvent.pointerMove(document, { clientX: 20, clientY: 250 });
      await waitFor(() =>
        expect(groups[1]).toHaveAttribute("data-drop-target", "true"),
      );
      if (ending === "cancel")
        fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
      else {
        if (ending === "departure") {
          fireEvent.pointerMove(document, { clientX: 600, clientY: 500 });
          await waitFor(() =>
            expect(groups[1]).toHaveAttribute("data-drop-target", "false"),
          );
        }
        fireEvent.pointerUp(document);
      }
      await waitFor(() => {
        for (const group of screen.getAllByTestId(
          "requirements-editor-group",
        )) {
          expect(group).toHaveAttribute("data-drop-target", "false");
          expect(group).toHaveStyle({ borderStyle: "solid" });
        }
      });
      if (ending === "drop") {
        expect(latest().find((r) => r.id === initial[0].id)).toEqual({
          ...initial[0],
          group: "Beta",
        });
        expect(latest().find((r) => r.id === initial[1].id)).toEqual(
          initial[1],
        );
      } else {
        expect(latest()).toEqual(initial);
        expect(changes).toHaveLength(0);
      }
    },
  );

  it("cites only slot-eligible results and removes cited mentions", async () => {
    vi.useFakeTimers();
    const results: SearchEntity[] = [
      { id: FEATURE_ID, type: "feature", name: "Self" },
      { id: PARENT_ID, type: "feature", name: "Parent" },
      { id: uuid("c"), type: "task", name: "Build it" },
    ];
    const search = vi.fn(async () => results);
    const { latest } = renderEditor([record(uuid("1"), "One")], search);

    const slot = screen
      .getAllByTestId("requirement-citation-slot")
      .find((el) => el.getAttribute("data-citation-slot") === "fulfilledBy")!;
    fireEvent.click(within(slot).getByTestId("requirement-citation-add"));
    fireEvent.change(screen.getByTestId("requirement-citation-search-input"), {
      target: { value: "build" },
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    vi.useRealTimers();

    expect(search).toHaveBeenCalledWith("build", {
      kind: "entity-types",
      entityTypes: ["task"],
    });
    const rows = screen.getAllByTestId("slash-entity-search-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Build it"),
    ]);
    fireEvent.click(rows[0]);

    expect(latest()[0].fulfilledBy).toEqual([
      { entityType: "TASK", entityId: uuid("c"), entityTitle: "Build it" },
    ]);
    const citation = screen.getByTestId("requirement-citation");
    expect(within(citation).getByTestId("mention-badge")).toHaveAttribute(
      "data-entity-type",
      "TASK",
    );
    fireEvent.click(
      within(citation).getByTestId("requirement-citation-remove"),
    );
    expect(latest()[0].fulfilledBy).toEqual([]);
  });

  it("fails closed on content that is not the canonical schema", () => {
    render(
      <ThemeProvider theme={createTheme()}>
        <FeatureRequirementsSectionEditor
          value='{"records":"nope"}'
          onChange={vi.fn()}
          disabled={false}
          context={{
            organizationId: "org",
            projectId: "project",
            featureId: FEATURE_ID,
            parentId: null,
            onSearchEntities: async () => [],
          }}
        />
      </ThemeProvider>,
    );
    expect(
      screen.getByTestId("requirements-editor-invalid"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("requirements-editor-add"),
    ).not.toBeInTheDocument();
  });
});
