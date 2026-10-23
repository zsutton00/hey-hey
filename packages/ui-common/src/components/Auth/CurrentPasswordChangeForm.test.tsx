import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import {
  CurrentPasswordChangeForm,
  type CurrentPasswordChangeCredentials,
} from "./CurrentPasswordChangeForm";

const renderForm = (
  onSubmit: (credentials: CurrentPasswordChangeCredentials) => Promise<void>,
) =>
  render(
    <I18nextProvider i18n={i18n}>
      <CurrentPasswordChangeForm onSubmit={onSubmit} />
    </I18nextProvider>,
  );

describe("CurrentPasswordChangeForm", () => {
  it("validates and submits the shared current-password payload once", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderForm(onSubmit);

    await user.type(screen.getByTestId("current-password-change-current"), "current-password");
    await user.type(screen.getByTestId("current-password-change-new"), "replacement-password");
    await user.type(
      screen.getByTestId("current-password-change-confirm"),
      "replacement-password",
    );
    await user.click(screen.getByTestId("current-password-change-submit"));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      currentPassword: "current-password",
      newPassword: "replacement-password",
    });
    expect(screen.getByTestId("current-password-change-success")).toBeInTheDocument();
  });

  it("rejects mismatched replacement passwords without submitting", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderForm(onSubmit);

    await user.type(screen.getByTestId("current-password-change-current"), "current-password");
    await user.type(screen.getByTestId("current-password-change-new"), "replacement-password");
    await user.type(screen.getByTestId("current-password-change-confirm"), "different-password");
    await user.click(screen.getByTestId("current-password-change-submit"));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("current-password-change-error")).toHaveTextContent(
      "Passwords do not match",
    );
  });

  it("shows a mutation error while retaining the signed-in form state", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Current password is incorrect"));
    const user = userEvent.setup();
    renderForm(onSubmit);

    await user.type(screen.getByTestId("current-password-change-current"), "wrong-password");
    await user.type(screen.getByTestId("current-password-change-new"), "replacement-password");
    await user.type(
      screen.getByTestId("current-password-change-confirm"),
      "replacement-password",
    );
    await user.click(screen.getByTestId("current-password-change-submit"));

    expect(screen.getByTestId("current-password-change-error")).toHaveTextContent(
      "Current password is incorrect",
    );
    expect(screen.getByTestId("current-password-change-current")).toHaveValue("wrong-password");
  });
});
