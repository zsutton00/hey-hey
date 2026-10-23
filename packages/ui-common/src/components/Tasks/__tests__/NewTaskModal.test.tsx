import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Priority, WorkStatus } from "../../../api";
import { NewTaskModal } from "../NewTaskModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("../../../hooks/useEditorContext", () => ({
  useProjectIds: () => null,
}));

vi.mock("../../../data/hooks/useMentionEntitySearch", () => ({
  useMentionEntitySearch: () => ({
    searchEntities: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../../SmarterTextAreaCard/MentionPlugin", () => ({
  MentionPlugin: () => null,
}));

describe("NewTaskModal", () => {
  it("renders the Lexical-based description editor inside the dialog", () => {
    render(<NewTaskModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByTestId("smarter-textarea-card")
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("smarter-textarea-input")
    ).toBeInTheDocument();
  });

  it("does not render the save buttons in the transient editor", () => {
    render(<NewTaskModal open onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(
      screen.queryByTestId("smarter-textarea-save-without-feedback")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("smarter-textarea-save-with-feedback")
    ).not.toBeInTheDocument();
  });

  it("submits with name only and no description sections when description is empty", async () => {
    const onSubmit = vi.fn();
    render(<NewTaskModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    const dialog = screen.getByRole("dialog");
    const nameField = within(dialog).getByLabelText("tasks.form.title");
    await userEvent.type(nameField, "Draft task");

    const createButton = within(dialog).getByRole("button", {
      name: "common.create",
    });
    expect(createButton).toBeEnabled();
    await userEvent.click(createButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "Draft task",
      priority: Priority.Medium,
      status: WorkStatus.RefiningDescription,
    });
    expect(payload.sections).toBeUndefined();
  });
});
