import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "@hey-hey/ui-common/i18n";
import {
  ChangePasswordPage,
  clearCapturedRecoveryCredential,
} from "./ChangePasswordPage";

const completeChangePassword = vi.fn();

vi.mock("@hey-hey/ui-common/context", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    user: null,
    loading: false,
    login: vi.fn(),
    completeChangePassword,
    logout: vi.fn(),
    toggleDevAdminMode: vi.fn(),
  }),
}));

const renderPage = (
  passwordChangeToken: string | undefined = "pw-token",
  from: unknown = "/projects"
) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/change-password",
            state: passwordChangeToken
              ? { passwordChangeToken, from }
              : undefined,
          },
        ]}
      >
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route
            path="/projects"
            element={<div data-testid="projects-landing">Projects landing</div>}
          />
          <Route
            path="/home"
            element={<div data-testid="home-landing">Home landing</div>}
          />
          <Route
            path="/projects/:projectId/features/:taskId"
            element={<div data-testid="feature-page">Feature page</div>}
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );

describe("ChangePasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCapturedRecoveryCredential();
    window.history.replaceState({}, "", "/change-password");
  });

  it("submits via AuthContext.completeChangePassword and navigates to from", async () => {
    completeChangePassword.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      user: { id: "user-1", email: "test@example.com" },
    });

    const user = userEvent.setup();
    renderPage("pw-token");

    await user.type(screen.getByTestId("new-password-input"), "newPassword123");
    await user.type(
      screen.getByTestId("confirm-password-input"),
      "newPassword123"
    );
    await user.click(screen.getByTestId("change-password-submit"));

    await waitFor(() => {
      expect(completeChangePassword).toHaveBeenCalledWith(
        "pw-token",
        "newPassword123"
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("projects-landing")).toBeInTheDocument();
    });
  });

  it("preserves a valid route target after password change", async () => {
    completeChangePassword.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      user: { id: "user-1", email: "test@example.com" },
    });

    const user = userEvent.setup();
    renderPage(
      "pw-token",
      "/projects/project-1/features/task-1?tab=docs#notes"
    );

    await user.type(screen.getByTestId("new-password-input"), "newPassword123");
    await user.type(
      screen.getByTestId("confirm-password-input"),
      "newPassword123"
    );
    await user.click(screen.getByTestId("change-password-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("feature-page")).toBeInTheDocument();
    });
  });

  it("falls back when password-change state has an unsafe route target", async () => {
    completeChangePassword.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      user: { id: "user-1", email: "test@example.com" },
    });

    const user = userEvent.setup();
    renderPage("pw-token", "https://example.com/phish");

    await user.type(screen.getByTestId("new-password-input"), "newPassword123");
    await user.type(
      screen.getByTestId("confirm-password-input"),
      "newPassword123"
    );
    await user.click(screen.getByTestId("change-password-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("home-landing")).toBeInTheDocument();
    });
  });

  it("surfaces an error and stays on the page when completeChangePassword rejects", async () => {
    completeChangePassword.mockRejectedValue(new Error("token expired"));

    const user = userEvent.setup();
    renderPage("pw-token");

    await user.type(screen.getByTestId("new-password-input"), "newPassword123");
    await user.type(
      screen.getByTestId("confirm-password-input"),
      "newPassword123"
    );
    await user.click(screen.getByTestId("change-password-submit"));

    await waitFor(() => {
      expect(screen.getByText("token expired")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("projects-landing")).not.toBeInTheDocument();
  });

  it("captures a recovery credential before scrubbing the fragment", async () => {
    completeChangePassword.mockResolvedValue({
      accessToken: "new-access-token",
      expiresIn: 900,
      user: { id: "user-1", email: "test@example.com" },
    });
    window.history.replaceState(
      {},
      "",
      "/change-password#recoveryCredential=recovery-secret"
    );
    const user = userEvent.setup();
    renderPage(undefined);

    expect(window.location.hash).toBe("");
    await user.type(screen.getByTestId("new-password-input"), "newPassword123");
    await user.type(
      screen.getByTestId("confirm-password-input"),
      "newPassword123"
    );
    await user.click(screen.getByTestId("change-password-submit"));

    await waitFor(() =>
      expect(completeChangePassword).toHaveBeenCalledWith(
        "recovery-secret",
        "newPassword123"
      )
    );
  });

  it("does not reuse a recovery credential after the page is left", async () => {
    window.history.replaceState(
      {},
      "",
      "/change-password#recoveryCredential=recovery-secret"
    );
    const recoveryPage = renderPage(undefined);
    expect(window.location.hash).toBe("");
    recoveryPage.unmount();

    completeChangePassword.mockResolvedValue({
      accessToken: "new-access-token",
      expiresIn: 900,
      user: { id: "user-1", email: "test@example.com" },
    });
    const user = userEvent.setup();
    renderPage("required-change-secret");
    await user.type(screen.getByTestId("new-password-input"), "newPassword123");
    await user.type(
      screen.getByTestId("confirm-password-input"),
      "newPassword123"
    );
    await user.click(screen.getByTestId("change-password-submit"));

    await waitFor(() =>
      expect(completeChangePassword).toHaveBeenCalledWith(
        "required-change-secret",
        "newPassword123"
      )
    );
  });

  it("shows a generic recovery-link failure", async () => {
    completeChangePassword.mockRejectedValue(new Error("database detail"));
    window.history.replaceState(
      {},
      "",
      "/change-password#recoveryCredential=bad-secret"
    );
    const user = userEvent.setup();
    renderPage(undefined);
    await user.type(screen.getByTestId("new-password-input"), "newPassword123");
    await user.type(
      screen.getByTestId("confirm-password-input"),
      "newPassword123"
    );
    await user.click(screen.getByTestId("change-password-submit"));

    expect(
      await screen.findByText(
        "This password-change link is invalid or no longer available."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("database detail")).not.toBeInTheDocument();
  });
});
