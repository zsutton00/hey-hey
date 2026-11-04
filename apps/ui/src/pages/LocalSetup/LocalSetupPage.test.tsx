import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { acceptBrowserAuthSession } from "@hey-hey/ui-common/services";
import { createHmac } from "node:crypto";
import { LocalSetupPage } from "./LocalSetupPage";
import {
  computeLocalApprovalProof,
  forgetLocalPairing,
} from "../Settings/localApproval";

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

vi.mock("../Settings/ClaimMachine", () => ({
  ClaimMachine: ({
    initialCode,
    localApprovalSecret,
  }: {
    initialCode: string | null;
    localApprovalSecret?: string | null;
  }) => (
    <div data-testid="claim-machine">
      {initialCode}|{localApprovalSecret}
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/context")>()),
  useAuth: () => ({ isAuthenticated: true }),
}));

const HANDOFF_TOKEN = "one-use-local-handoff-token";

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
        <Route path="/welcome" element={<LocationProbe />} />
        <Route path="/home" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LocalSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetLocalPairing();
    sessionStorage.clear();
    authClient.getLocalSetupStatus.mockResolvedValue(statusResponse());
    authClient.saveLocalDisplayName.mockResolvedValue(
      statusResponse({ nameComplete: true }),
    );
  });

  it("opens directly on the display name question", async () => {
    renderLocalPage();

    expect(
      await screen.findByRole("heading", { name: "WHAT SHOULD WE CALL YOU?" }),
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
    const handoffToken = HANDOFF_TOKEN;
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
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(HANDOFF_TOKEN);
  });

  it("takes the CLI code and approval secret from the fragment through name entry straight to passkey approval", async () => {
    const user = userEvent.setup();
    const code = "ABCDEFGHJK";
    const secret = Buffer.alloc(32, 9).toString("base64url");
    authClient.completeLocalHandoff.mockResolvedValue({
      data: { data: { accessToken: "local-access-token" } },
    });
    authClient.getLocalSetupStatus
      .mockResolvedValueOnce(statusResponse())
      .mockResolvedValue(statusResponse({ nameComplete: true }));
    window.history.replaceState(
      {},
      "",
      `/local?pairing=started#code=${code}&approval=${secret}&handoff=token`,
    );
    renderLocalPage("/local?pairing=started");

    await screen.findByLabelText("Name");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(code);
    await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // The next screen is the passkey step itself, with no page to click through.
    expect(await screen.findByTestId("claim-machine")).toHaveTextContent(
      `${code}|${secret}`,
    );
    expect(
      screen.queryByRole("link", { name: "Continue to pairing" }),
    ).not.toBeInTheDocument();

    // The app tree remounts while the session refreshes; the cleared fragment must not matter.
    cleanup();
    renderLocalPage("/local?pairing=started");
    expect(await screen.findByTestId("claim-machine")).toHaveTextContent(
      `${code}|${secret}`,
    );
    expect(localStorage.length).toBe(0);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(code);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(secret);

    // The browser proof matches what the originating CLI recomputes.
    const binding = {
      enrollmentId: "550e8400-e29b-41d4-a716-446655440040",
      accountId: "account-1",
      organizationId: "organization-1",
      controllerCredentialId: "Y29udHJvbGxlcg",
    };
    expect(await computeLocalApprovalProof(secret, binding)).toBe(
      createHmac("sha256", Buffer.from(secret, "base64url"))
        .update(
          `heyhey-local-approval-v1${binding.enrollmentId}${binding.accountId}${binding.organizationId}${binding.controllerCredentialId}`,
        )
        .digest("base64url"),
    );
  });

  it("explains on screen why pairing details are missing, without exposing any secret", async () => {
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({ nameComplete: true }),
    );
    window.history.replaceState({}, "", "/local?pairing=started");
    renderLocalPage("/local?pairing=started");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "did not receive its pairing details",
    );
    const details = screen.getByTestId("local-setup-diagnostics");
    expect(details).toHaveTextContent(
      "handoff=absent code=absent approval=absent",
    );
    expect(details).toHaveTextContent("pairing-held=false");
    expect(details).toHaveTextContent("view: missing-pairing-details");
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
    renderLocalPage();

    await screen.findByLabelText("Name");

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
    expect(screen.queryByTestId("claim-machine")).not.toBeInTheDocument();
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
