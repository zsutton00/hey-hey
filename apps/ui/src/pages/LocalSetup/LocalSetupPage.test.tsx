import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { acceptBrowserAuthSession } from "@hey-hey/ui-common/services";
import { LocalSetupPage } from "./LocalSetupPage";

const { authClient } = vi.hoisted(() => ({
  authClient: {
    completeLocalHandoff: vi.fn(),
    getLocalSetupStatus: vi.fn(),
    saveLocalDisplayName: vi.fn(),
  },
}));

vi.mock("@hey-hey/ui-common/clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/clients")>()),
  getApiRuntime: vi.fn(() => ({ clients: { auth: authClient } })),
}));

vi.mock("@hey-hey/ui-common/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/services")>()),
  acceptBrowserAuthSession: vi.fn(),
  refreshAuthToken: vi.fn().mockResolvedValue({}),
}));

vi.mock("@hey-hey/ui-common/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/context")>()),
  useAuth: () => ({ isAuthenticated: true }),
}));

const statusResponse = (
  overrides: Partial<{
    nameComplete: boolean;
    browserSession: boolean;
    machineConnected: boolean;
    executionReady: boolean;
    hasProjects: boolean;
  }> = {},
) => ({
  data: {
    data: {
      nameComplete: false,
      browserSession: true,
      machineConnected: false,
      executionReady: false,
      hasProjects: false,
      ...overrides,
    },
  },
});

function LocationProbe(): React.JSX.Element {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderLocalPage(initialPath = "/local") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/local" element={<LocalSetupPage />} />
        <Route path="/pairing" element={<LocationProbe />} />
        <Route path="/welcome" element={<LocationProbe />} />
        <Route path="/home" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LocalSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authClient.getLocalSetupStatus.mockResolvedValue(statusResponse());
    authClient.saveLocalDisplayName.mockResolvedValue(
      statusResponse({ nameComplete: true }),
    );
  });

  it("shows the first-use steps and collects only a display name", async () => {
    const user = userEvent.setup();
    renderLocalPage();

    expect(
      await screen.findByRole("heading", { name: "GET STARTED" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Connect Hey Hey to your coding plans"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Get started" }));

    expect(
      screen.getByRole("heading", { name: "WHAT SHOULD WE CALL YOU?" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(
      document.querySelector('input[type="email"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('input[type="password"]'),
    ).not.toBeInTheDocument();
  });

  it("scrubs the one-use handoff from the URL and keeps it out of browser storage", async () => {
    const handoffToken = "one-use-local-handoff-token";
    authClient.completeLocalHandoff.mockResolvedValue({
      data: { data: { accessToken: "local-access-token" } },
    });
    window.history.replaceState({}, "", `/local#handoff=${handoffToken}`);

    renderLocalPage();

    await waitFor(() => {
      expect(authClient.completeLocalHandoff).toHaveBeenCalledWith({
        localHandoffRequestDto: { handoffToken },
      });
    });
    await waitFor(() => {
      expect(acceptBrowserAuthSession).toHaveBeenCalledWith({
        accessToken: "local-access-token",
      });
    });
    expect(window.location.hash).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("saves the name, explains the existing pairing ceremony, and requires manual CLI code entry", async () => {
    const user = userEvent.setup();
    authClient.getLocalSetupStatus
      .mockResolvedValueOnce(statusResponse())
      .mockResolvedValue(statusResponse({ nameComplete: true }));
    renderLocalPage("/local?pairing=started");

    await user.click(
      await screen.findByRole("button", { name: "Get started" }),
    );
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByRole("heading", { name: "CONNECT THIS COMPUTER" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Enter the code from your terminal"),
    ).toBeInTheDocument();
    expect(screen.getByText("Create a pairing passkey")).toBeInTheDocument();
    expect(screen.getByText("Confirm in your terminal")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Continue to pairing" }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/pairing?returnTo=local",
    );
    expect(authClient.saveLocalDisplayName).toHaveBeenCalledWith({
      localNameRequestDto: { name: "Ada Lovelace" },
    });
  });

  it("shows the connected handoff for a live CLI connection", async () => {
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({
        nameComplete: true,
        machineConnected: true,
        executionReady: false,
        hasProjects: false,
      }),
    );
    const user = userEvent.setup();
    renderLocalPage();

    expect(
      await screen.findByRole("heading", {
        name: "CONNECTED TO YOUR CODING PLANS",
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Bootstrap your first project" }),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent("/welcome");
  });

  it("asks for the display name before showing a connected handoff", async () => {
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({
        nameComplete: false,
        machineConnected: true,
      }),
    );
    const user = userEvent.setup();
    renderLocalPage();

    await user.click(
      await screen.findByRole("button", { name: "Get started" }),
    );

    expect(
      screen.getByRole("heading", { name: "WHAT SHOULD WE CALL YOU?" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "CONNECTED TO YOUR CODING PLANS",
      }),
    ).not.toBeInTheDocument();
  });

  it("shows a reconnect state without asking an already-paired return visit to enroll again", async () => {
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({ nameComplete: true, machineConnected: false }),
    );
    renderLocalPage();

    expect(
      await screen.findByText(
        "Waiting for the local CLI to connect to Hey Hey…",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Create a pairing passkey"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Connecting");
  });

  it("automatically returns existing projects to the workspace", async () => {
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({
        nameComplete: true,
        machineConnected: true,
        hasProjects: true,
      }),
    );
    renderLocalPage();
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/home");
    });
  });
});
