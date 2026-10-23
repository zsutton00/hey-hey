import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FeatureTag, Priority, WorkStatus } from "../../../api";
import { FEATURE_TAG_PALETTE } from "../featureTagPalette";
import { NewFeatureModal } from "../NewFeatureModal";

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

function getTagCombobox(container: HTMLElement): HTMLElement {
  const comboboxes = within(container).getAllByRole("combobox");
  const tagCombobox = comboboxes.find(
    (el) => el.getAttribute("aria-labelledby") !== "priority-select-label"
  );
  if (!tagCombobox) throw new Error("Tag combobox not found");
  return tagCombobox;
}

describe("NewFeatureModal", () => {
  it("renders the FeatureTagSelector inside the dialog", () => {
    render(
      <NewFeatureModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Untagged")).toBeInTheDocument();
    expect(getTagCombobox(dialog)).toBeInTheDocument();
  });

  it("keeps the create button disabled until a tag is chosen", async () => {
    render(
      <NewFeatureModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog");
    const nameField = within(dialog).getByLabelText("tasks.form.title");
    await userEvent.type(nameField, "My new feature");

    const createButton = within(dialog).getByRole("button", {
      name: "common.create",
    });
    expect(createButton).toBeDisabled();
  });

  it("submits with the chosen tag once name and tag are set", async () => {
    const onSubmit = vi.fn();
    render(
      <NewFeatureModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );

    const dialog = screen.getByRole("dialog");
    const nameField = within(dialog).getByLabelText("tasks.form.title");
    await userEvent.type(nameField, "My new feature");

    await userEvent.click(getTagCombobox(dialog));
    await userEvent.click(
      screen.getByRole("option", {
        name: FEATURE_TAG_PALETTE[FeatureTag.Backend].label,
      })
    );

    const createButton = within(dialog).getByRole("button", {
      name: "common.create",
    });
    expect(createButton).toBeEnabled();
    await userEvent.click(createButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: "My new feature",
      tag: FeatureTag.Backend,
      priority: Priority.Medium,
      status: WorkStatus.RefiningDescription,
    });
  });
});
