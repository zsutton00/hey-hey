import React, { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { I18nextProvider } from "react-i18next";
import i18n from "@hey-hey/ui-common/i18n";
import { WelcomeSignInForm } from "./WelcomeSignInForm";

const login = vi.fn();
const completeChangePassword = vi.fn();
const logout = vi.fn();
const refreshOrganizations = vi.fn();
const authState = {
  isAuthenticated: false,
  loading: false,
};
const organizationState: {
  currentOrganization: { id: string; name: string } | null;
} = {
  currentOrganization: null,
};

const organization = { id: "org-1", name: "Ada's organization" };

vi.mock("@hey-hey/ui-common/context", () => ({
  useAuth: () => ({
    isAuthenticated: authState.isAuthenticated,
    user: null,
    loading: authState.loading,
    login,
    completeChangePassword,
    logout,
    toggleDevAdminMode: vi.fn(),
  }),
  useOrganization: () => ({
    organizations: organizationState.currentOrganization
      ? [organizationState.currentOrganization]
      : [],
    currentOrganization: organizationState.currentOrganization,
    loading: false,
    error: null,
    switchOrganization: vi.fn(),
    refreshOrganizations,
    createOrganization: vi.fn(),
  }),
}));

const renderForm = (
  searchParams = "welcome=1&name=Ada",
  credential?: string,
): ReturnType<typeof render> => {
  const hash = credential
    ? `#welcomeCredential=${encodeURIComponent(credential)}`
    : "";
  window.history.replaceState({}, "", `/?${searchParams}${hash}`);

  return render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter searchParams={searchParams}>
          <MemoryRouter initialEntries={[`/?${searchParams}${hash}`]}>
            <Routes>
              <Route path="/" element={<WelcomeSignInForm />} />
              <Route
                path="/welcome"
                element={
                  <div data-testid="welcome-landing">Welcome landing</div>
                }
              />
            </Routes>
          </MemoryRouter>
        </NuqsTestingAdapter>
      </I18nextProvider>
    </StrictMode>,
  );
};

describe("WelcomeSignInForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.isAuthenticated = false;
    authState.loading = false;
    organizationState.currentOrganization = null;
    completeChangePassword.mockImplementation(async () => {
      authState.isAuthenticated = true;
      return {
        accessToken: "new-access-token",
        user: { id: "user-1", email: "ada@example.com" },
      };
    });
    refreshOrganizations.mockImplementation(async () => {
      organizationState.currentOrganization = organization;
    });
    window.history.replaceState({}, "", "/");
  });

  it("captures and scrubs the welcome credential before interaction", () => {
    renderForm("welcome=1&name=Ada", "welcome-token");

    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?welcome=1&name=Ada");
    expect(screen.queryByTestId("welcome-email-input")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("welcome-temp-password-input"),
    ).not.toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it("retains the captured credential across a remount after URL scrubbing", async () => {
    const firstMount = renderForm(
      "welcome=1&name=Ada",
      "remount-safe-token",
    );

    expect(window.location.hash).toBe("");
    firstMount.unmount();
    renderForm("welcome=1&name=Ada");

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId("welcome-new-password-input"),
      "newPassword123",
    );
    await user.type(
      screen.getByTestId("welcome-confirm-password-input"),
      "newPassword123",
    );
    await user.click(screen.getByTestId("welcome-submit"));

    await waitFor(() => {
      expect(completeChangePassword).toHaveBeenCalledWith(
        "remount-safe-token",
        "newPassword123",
      );
    });
  });

  it("completes the password change with the captured credential and navigates to /welcome", async () => {
    const user = userEvent.setup();
    renderForm("welcome=1&name=Ada", "welcome-token");

    await user.type(
      screen.getByTestId("welcome-new-password-input"),
      "newPassword123",
    );
    await user.type(
      screen.getByTestId("welcome-confirm-password-input"),
      "newPassword123",
    );
    await user.click(screen.getByTestId("welcome-submit"));

    await waitFor(() => {
      expect(completeChangePassword).toHaveBeenCalledWith(
        "welcome-token",
        "newPassword123",
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("welcome-landing")).toBeInTheDocument();
    });
    expect(login).not.toHaveBeenCalled();
  });

  it("uses the generic welcome-link error when the credential is missing", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(
      screen.getByTestId("welcome-new-password-input"),
      "newPassword123",
    );
    await user.type(
      screen.getByTestId("welcome-confirm-password-input"),
      "newPassword123",
    );
    await user.click(screen.getByTestId("welcome-submit"));

    expect(
      screen.getByText("This welcome link is invalid or has expired."),
    ).toBeInTheDocument();
    expect(completeChangePassword).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("uses the same generic error when the credential is rejected", async () => {
    completeChangePassword.mockRejectedValue(new Error("token consumed"));

    const user = userEvent.setup();
    renderForm("welcome=1&name=Ada", "replayed-token");

    await user.type(
      screen.getByTestId("welcome-new-password-input"),
      "newPassword123",
    );
    await user.type(
      screen.getByTestId("welcome-confirm-password-input"),
      "newPassword123",
    );
    await user.click(screen.getByTestId("welcome-submit"));

    await waitFor(() => {
      expect(
        screen.getByText("This welcome link is invalid or has expired."),
      ).toBeInTheDocument();
    });

    expect(completeChangePassword).toHaveBeenCalledWith(
      "replayed-token",
      "newPassword123",
    );
    expect(login).not.toHaveBeenCalled();
    expect(screen.queryByTestId("projects-landing")).not.toBeInTheDocument();
  });

  it("does not navigate until the password exchange resolves", async () => {
    let resolveExchange: (() => void) | undefined;
    completeChangePassword.mockReturnValue(
      new Promise((resolve) => {
        resolveExchange = () => {
          authState.isAuthenticated = true;
          resolve({});
        };
      }),
    );
    const user = userEvent.setup();
    renderForm("welcome=1&name=Ada", "welcome-token");

    await user.type(
      screen.getByTestId("welcome-new-password-input"),
      "newPassword123",
    );
    await user.type(
      screen.getByTestId("welcome-confirm-password-input"),
      "newPassword123",
    );
    await user.click(screen.getByTestId("welcome-submit"));

    expect(screen.queryByTestId("welcome-landing")).not.toBeInTheDocument();
    resolveExchange?.();

    await waitFor(() => {
      expect(screen.getByTestId("welcome-landing")).toBeInTheDocument();
    });
  });

  it("keeps a visible handoff state until organization context is ready", async () => {
    let resolveOrganizations: (() => void) | undefined;
    refreshOrganizations.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveOrganizations = () => {
          organizationState.currentOrganization = organization;
          resolve();
        };
      }),
    );

    const user = userEvent.setup();
    renderForm("welcome=1&name=Ada", "welcome-token");

    await user.type(
      screen.getByTestId("welcome-new-password-input"),
      "newPassword123",
    );
    await user.type(
      screen.getByTestId("welcome-confirm-password-input"),
      "newPassword123",
    );
    await user.click(screen.getByTestId("welcome-submit"));

    expect(screen.getByTestId("welcome-handoff-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("welcome-landing")).not.toBeInTheDocument();

    resolveOrganizations?.();

    await waitFor(() => {
      expect(screen.getByTestId("welcome-landing")).toBeInTheDocument();
    });
  });

  it("offers organization initialization retry instead of leaving a blank page", async () => {
    refreshOrganizations
      .mockRejectedValueOnce(new Error("organization unavailable"))
      .mockImplementationOnce(async () => {
        organizationState.currentOrganization = organization;
      });

    const user = userEvent.setup();
    renderForm("welcome=1&name=Ada", "welcome-token");

    await user.type(
      screen.getByTestId("welcome-new-password-input"),
      "newPassword123",
    );
    await user.type(
      screen.getByTestId("welcome-confirm-password-input"),
      "newPassword123",
    );
    await user.click(screen.getByTestId("welcome-submit"));

    expect(await screen.findByTestId("welcome-handoff-error")).toHaveTextContent(
      "We couldn't finish setting up your organization.",
    );

    await user.click(screen.getByTestId("welcome-handoff-retry"));

    await waitFor(() => {
      expect(screen.getByTestId("welcome-landing")).toBeInTheDocument();
    });
    expect(refreshOrganizations).toHaveBeenCalledTimes(2);
  });

  it("resumes organization handoff after remounting following a successful exchange", async () => {
    refreshOrganizations.mockImplementation(() => new Promise<void>(() => {}));
    const firstMount = renderForm("welcome=1", "remount-after-exchange-token");
    const user = userEvent.setup();
    await user.type(screen.getByTestId("welcome-new-password-input"), "newPassword123");
    await user.type(screen.getByTestId("welcome-confirm-password-input"), "newPassword123");
    await user.click(screen.getByTestId("welcome-submit"));
    expect(await screen.findByTestId("welcome-handoff-loading")).toBeInTheDocument();

    firstMount.unmount();
    refreshOrganizations.mockImplementation(async () => {
      organizationState.currentOrganization = organization;
    });
    renderForm("welcome=1");

    expect(screen.queryByTestId("welcome-form")).not.toBeInTheDocument();
    expect(await screen.findByTestId("welcome-landing")).toBeInTheDocument();
    expect(completeChangePassword).toHaveBeenCalledTimes(1);
  });

  it("hands an authenticated welcome visit to the organization without a credential", async () => {
    authState.isAuthenticated = true;
    renderForm();

    expect(screen.queryByTestId("welcome-form")).not.toBeInTheDocument();
    expect(await screen.findByTestId("welcome-landing")).toBeInTheDocument();
    expect(completeChangePassword).not.toHaveBeenCalled();
  });
});
