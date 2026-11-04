import { afterEach, expect, it } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { AuthProvider, useAuth } from "@hey-hey/ui-common/context";
import { initializeBrowserApiRuntime } from "@hey-hey/ui-common/clients";
import { clearAuthToken, getAuthToken } from "@hey-hey/ui-common/services";
import { LocalSetupPage } from "./LocalSetupPage";

function Identity() {
  const { user, isAuthenticated } = useAuth();
  return (
    <p data-testid="identity">{isAuthenticated ? user?.name : "signed out"}</p>
  );
}

afterEach(() => {
  cleanup();
  clearAuthToken();
  window.history.replaceState({}, "", "/");
});

it("establishes first-use access through handoff, then refreshes the real provider after saving the name", async () => {
  clearAuthToken();
  initializeBrowserApiRuntime({ baseUrl: "http://localhost:3000/api/v1" });
  const handoffToken = "a".repeat(43);
  window.history.replaceState({}, "", `/local#handoff=${handoffToken}`);
  let name = "Local User";
  let nameComplete = false;
  let machineConnected = false;
  let hasProjects = false;
  let authorizedStatus = false;
  let handedOff = false;
  const session = () => ({
    accessToken: "local-access-token",
    expiresIn: 900,
    user: {
      id: "550e8400-e29b-41d4-a716-446655440001",
      currentOrganizationId: "550e8400-e29b-41d4-a716-446655440002",
      email: "local@installation.invalid",
      name,
      isActive: true,
      isLocalAccount: true,
      createdAt: "2026-11-02T00:00:00Z",
      updatedAt: "2026-11-02T00:00:00Z",
    },
  });
  const status = () => ({
    nameComplete,
    browserSession: true,
    machineConnected,
    executionReady: false,
    hasProjects,
  });
  globalThis.mswServer.use(
    http.post("*/auth/refresh", () =>
      handedOff
        ? HttpResponse.json({ data: session() })
        : new HttpResponse(null, { status: 401 }),
    ),
    http.post("*/auth/local/handoff", async ({ request }) => {
      expect(await request.json()).toEqual({ handoffToken });
      // Let the provider's initial unauthenticated renewal finish first.
      await waitFor(() =>
        expect(screen.getByTestId("identity")).toHaveTextContent("signed out"),
      );
      handedOff = true;
      return HttpResponse.json({ data: session() });
    }),
    http.get("*/auth/local/status", ({ request }) => {
      expect(request.headers.get("authorization")).toBe(
        "Bearer local-access-token",
      );
      authorizedStatus = true;
      return HttpResponse.json({ data: status() });
    }),
    http.patch("*/auth/local/name", async ({ request }) => {
      expect(request.headers.get("authorization")).toBe(
        "Bearer local-access-token",
      );
      expect(await request.json()).toEqual({ name: "Ada Lovelace" });
      name = "Ada Lovelace";
      nameComplete = true;
      return HttpResponse.json({ data: status() });
    }),
  );
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/local?pairing=started"]}>
        <Identity />
        <Routes>
          <Route path="/local" element={<LocalSetupPage />} />
          <Route
            path="/home"
            element={<p data-testid="workspace">Workspace</p>}
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  await screen.findByLabelText("Name");
  expect(
    screen.queryByRole("button", { name: "Get started" }),
  ).not.toBeInTheDocument();
  expect(authorizedStatus).toBe(true);
  expect(getAuthToken()).toBe("local-access-token");
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(screen.getByTestId("identity")).toHaveTextContent("Ada Lovelace"),
  );
  expect(
    await screen.findByRole("heading", { name: "CONNECT THIS COMPUTER" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Continue to pairing" }),
  ).not.toBeInTheDocument();
  expect(window.location.hash).toBe("");
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(
    handoffToken,
  );
  // A page reload loses in-memory access and restores the same identity via renewal.
  cleanup();
  clearAuthToken();
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/local?pairing=started"]}>
        <Identity />
        <Routes>
          <Route path="/local" element={<LocalSetupPage />} />
          <Route
            path="/home"
            element={<p data-testid="workspace">Workspace</p>}
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "CONNECT THIS COMPUTER" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("identity")).toHaveTextContent("Ada Lovelace");
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

  // A saved name and live connection alone lead to the connected handoff.
  machineConnected = true;
  expect(
    await screen.findByRole(
      "heading",
      {
        name: "CONNECTED TO YOUR CODING PLANS",
      },
      { timeout: 3000 },
    ),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("workspace")).not.toBeInTheDocument();

  // Returning to an installation with all three prerequisites opens the workspace.
  hasProjects = true;
  expect(
    await screen.findByTestId("workspace", {}, { timeout: 3000 }),
  ).toBeInTheDocument();
}, 10000);
