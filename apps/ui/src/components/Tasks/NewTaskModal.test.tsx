import { ModalRestoreControls } from "@hey-hey/ui-common/components/Modals";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { NewTaskModal } from "./NewTaskModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  KEYS: {
    common: { cancel: "common.cancel", create: "common.create" },
    tasks: {
      dialog: {
        acceptanceCriteriaLabel: "tasks.dialog.acceptanceCriteriaLabel",
        acceptanceCriteriaPlaceholder:
          "tasks.dialog.acceptanceCriteriaPlaceholder",
        createTitle: "tasks.dialog.createTitle",
        creating: "tasks.dialog.creating",
        descriptionPlaceholder: "tasks.dialog.descriptionPlaceholder",
        namePlaceholder: "tasks.dialog.namePlaceholder",
        nameRequired: "tasks.dialog.nameRequired",
        nameTooLong: "tasks.dialog.nameTooLong",
        nameTooShort: "tasks.dialog.nameTooShort",
      },
      form: {
        description: "tasks.form.description",
        priority: "tasks.form.priority",
        title: "tasks.form.title",
      },
      priority: {
        high: "tasks.priority.high",
        low: "tasks.priority.low",
        medium: "tasks.priority.medium",
      },
    },
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  SmarterTextAreaCard: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const fillTitle = (): void => {
  fireEvent.change(screen.getByRole("textbox", { name: "tasks.form.title" }), {
    target: { value: "New child" },
  });
};

describe("NewTaskModal registry sections", () => {
  it.each([
    [
      "BUG",
      [{ key: "description", label: "Observed Behavior" }],
      ["Observed Behavior"],
    ],
    [
      "FEATURE",
      [
        { key: "description", label: "Capability" },
        { key: "requirements", label: "Requirements" },
      ],
      ["Capability", "Requirements"],
    ],
    [
      "STANDARD",
      [
        { key: "description", label: "Description" },
        { key: "acceptanceCriteria", label: "Acceptance Criteria" },
      ],
      ["Description", "Acceptance Criteria"],
    ],
  ])("keeps the %s section shape distinct", (typeKey, sections, labels) => {
    render(
      <NewTaskModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initiativeId="initiative-1"
        sectionSelection={{ status: "resolved", typeKey, sections }}
      />,
    );

    expect(
      screen
        .getAllByRole("textbox")
        .slice(1)
        .map((field) => field.getAttribute("aria-label")),
    ).toEqual(labels);
  });

  it("renders declared sections in order and submits only their keys", () => {
    const onSubmit = vi.fn();
    render(
      <NewTaskModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initiativeId="initiative-1"
        sectionSelection={{
          status: "resolved",
          typeKey: "CUSTOM",
          sections: [
            {
              key: "audience",
              label: "Audience",
              writingStandard: "Name the intended readers.",
            },
            { key: "brief", label: "Brief" },
          ],
        }}
      />,
    );

    expect(
      screen
        .getAllByRole("textbox")
        .map((field) => field.getAttribute("aria-label")),
    ).toEqual(["tasks.form.title", "Name the intended readers.", "Brief"]);
    expect(
      screen.queryByText("tasks.dialog.acceptanceCriteriaLabel"),
    ).not.toBeInTheDocument();

    fillTitle();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Name the intended readers." }),
      {
        target: { value: "Operators" },
      },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Brief" }), {
      target: { value: "Ship the workflow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.create" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionContent: {
          audience: "Operators",
          brief: "Ship the workflow",
        },
      }),
    );
  });

  it("keeps a page-owned creation form without Minimize and does not invoke actions on opening", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(
      <>
        <NewTaskModal
          open
          onClose={onClose}
          onSubmit={onSubmit}
          initiativeId="initiative-1"
          sectionSelection={{
            status: "resolved",
            typeKey: "STANDARD",
            sections: [{ key: "description", label: "Description" }],
          }}
        />
        <ModalRestoreControls />
      </>,
    );
    fillTitle();
    const title = screen.getByRole("textbox", { name: "tasks.form.title" });
    expect(screen.queryByTestId("modal-minimize")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "tasks.form.title" })).toBe(
      title,
    );
    expect(title).toHaveValue("New child");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps an authoritative empty definition empty", () => {
    render(
      <NewTaskModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initiativeId="initiative-1"
        sectionSelection={{
          status: "resolved",
          typeKey: "EMPTY",
          sections: [],
        }}
      />,
    );

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(
      screen.queryByText("tasks.form.description"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("tasks.dialog.acceptanceCriteriaLabel"),
    ).not.toBeInTheDocument();
  });

  it("fails closed while the selected definition is unavailable", () => {
    render(
      <NewTaskModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initiativeId="initiative-1"
        sectionSelection={{ status: "unavailable", reason: "loading" }}
      />,
    );

    fillTitle();
    expect(
      screen.getByTestId("new-task-sections-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "common.create" }),
    ).toBeDisabled();
  });
});
