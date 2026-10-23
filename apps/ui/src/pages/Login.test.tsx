import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import i18n from "@hey-hey/ui-common/i18n";
import Login from "./Login";

const login = vi.fn();
const logout = vi.fn();
const changeCurrentPassword = vi.fn();
const initiatePasswordRecovery = vi.fn();
const useAuthMock = vi.fn();

vi.mock("@hey-hey/ui-common/context", () => ({
  useAuth: () => useAuthMock(),
}));

const LocationProbe = ({ label }: { label: string }) => {
  const location = useLocation();

  return (
    <div data-testid="current-location">
      {label}:{location.pathname}
      {location.search}
      {location.hash}
    </div>
  );
};

const renderLogin = (
  initialEntry: string | { pathname: string; state?: unknown }
) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/projects"
            element={<LocationProbe label="projects" />}
          />
          <Route path="/home" element={<LocationProbe label="home" />} />
          <Route
            path="/projects/:projectId/features/:taskId"
            element={<LocationProbe label="feature" />}
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>
  );

const submitLogin = async () => {
  const user = userEvent.setup();

  await user.type(screen.getByLabelText(/Email Address/), "test@example.com");
  await user.type(screen.getByLabelText(/Password/), "password123");
  await user.click(screen.getByRole("button", { name: "Sign In" }));
};

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    login.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: { id: "user-1", email: "test@example.com" },
    });
    useAuthMock.mockReturnValue({
      isAuthenticated: false,
      user: null,
      loading: false,
      login,
      logout,
      changeCurrentPassword,
      initiatePasswordRecovery,
      toggleDevAdminMode: vi.fn(),
    });
  });

  it("returns to the preserved route after successful authentication", async () => {
    renderLogin({
      pathname: "/login",
      state: {
        from: {
          pathname: "/projects/project-1/features/task-1",
          search: "?tab=docs",
          hash: "#requirements",
        },
      },
    });

    await submitLogin();

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent(
        "feature:/projects/project-1/features/task-1?tab=docs#requirements"
      );
    });
  });

  it("keeps the default destination when no return target exists", async () => {
    renderLogin("/login");

    await submitLogin();

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent(
        "home:/home"
      );
    });
  });

  it.each([
    "https://example.com/phish",
    "//example.com/phish",
    "/login?returnTo=/projects/project-1/features/task-1",
  ])("falls back for unsafe return target %s", async (from) => {
    renderLogin({
      pathname: "/login",
      state: { from },
    });

    await submitLogin();

    await waitFor(() => {
      expect(screen.getByTestId("current-location")).toHaveTextContent(
        "home:/home"
      );
    });
  });

  it("stays on login when authentication fails", async () => {
    login.mockRejectedValue(new Error("invalid credentials"));
    renderLogin({
      pathname: "/login",
      state: {
        from: {
          pathname: "/projects/project-1/features/task-1",
          search: "?tab=docs",
          hash: "#requirements",
        },
      },
    });

    await submitLogin();

    await waitFor(() => {
      expect(screen.getByText("invalid credentials")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("current-location")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Welcome Back" })
    ).toBeInTheDocument();
  });

  it.each([
    { entry: "/login", destination: "home:/home" },
    {
      entry: "/login?returnTo=%2Fprojects%2Fproject-1%2Ffeatures%2Ftask-1%3Ftab%3Ddocs%23requirements",
      destination: "feature:/projects/project-1/features/task-1?tab=docs#requirements",
    },
    {
      entry: { pathname: "/login", state: { from: "https://example.com/phish" } },
      destination: "home:/home",
    },
    {
      entry: { pathname: "/login", state: { from: "/login" } },
      destination: "home:/home",
    },
    {
      entry: {
        pathname: "/login",
        state: {
          from: {
            pathname: "/projects/project-1/features/task-1",
            search: "?tab=docs",
            hash: "#requirements",
          },
        },
      },
      destination: "feature:/projects/project-1/features/task-1?tab=docs#requirements",
    },
  ])("takes signed-in users directly to $destination", async ({ entry, destination }) => {
    useAuthMock.mockReturnValue({
      ...useAuthMock(),
      isAuthenticated: true,
      user: { id: "user-1", email: "test@example.com" },
    });

    renderLogin(entry);

    expect(await screen.findByTestId("current-location")).toHaveTextContent(destination);
    expect(screen.queryByText("Already Signed In")).not.toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    expect(changeCurrentPassword).not.toHaveBeenCalled();
  });

  it("requests recovery and renders the invariant acknowledgement", async () => {
    initiatePasswordRecovery.mockResolvedValue(
      "If an eligible account exists, recovery instructions will be sent."
    );
    renderLogin("/login");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("forgot-credentials-button"));
    expect(login).not.toHaveBeenCalled();
    await user.type(
      screen.getByTestId("password-recovery-email"),
      "person@example.com"
    );
    await user.click(screen.getByTestId("password-recovery-submit"));

    expect(initiatePasswordRecovery).toHaveBeenCalledWith("person@example.com");
    expect(
      await screen.findByTestId("password-recovery-acknowledgement")
    ).toHaveTextContent("We've sent an email with recovery instructions");
  });
});
