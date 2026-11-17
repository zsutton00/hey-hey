import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { acceptBrowserAuthSession } from "@hey-hey/ui-common/services";
import { createHash, createHmac } from "node:crypto";
import { LocalSetupPage } from "./LocalSetupPage";
import {
  computeLocalApprovalProof,
  forgetLocalPairing,
} from "../Settings/localApproval";

const { authClient, listPasskeys } = vi.hoisted(() => ({
  authClient: {
    completeLocalHandoff: vi.fn(),
    getLocalSetupStatus: vi.fn(),
    saveLocalDisplayName: vi.fn(),
    getLocalPasskeyRepair: vi.fn(),
    requestLocalPasskeyRepair: vi.fn(),
  },
  listPasskeys: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/clients")>()),
  getApiRuntime: vi.fn(() => ({ clients: { auth: authClient } })),
}));

vi.mock("@hey-hey/ui-common/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/services")>()),
  acceptBrowserAuthSession: vi.fn(),
  listAccountPasskeys: listPasskeys,
  refreshAuthToken: vi.fn().mockResolvedValue({}),
}));

vi.mock("../Settings/ClaimMachine", () => ({
  ClaimMachine: ({
    initialCode,
    localApprovalSecret,
    localAgents,
    onLocalPasskeyCreated,
    localReturning,
    onLocalPasskeyUnavailable,
    localRepair,
  }: {
    initialCode: string | null;
    localApprovalSecret?: string | null;
    localAgents?: unknown;
    onLocalPasskeyCreated?: (enrollmentId: string) => void;
    localReturning?: boolean;
    onLocalPasskeyUnavailable?: () => void;
    localRepair?: React.ReactNode;
  }) => (
    <div data-testid="claim-machine">
      {initialCode}|{localApprovalSecret}
      <span data-testid="claim-agents">{JSON.stringify(localAgents)}</span>
      <span data-testid="claim-returning">{String(localReturning)}</span>
      <button
        onClick={() =>
          onLocalPasskeyCreated?.("11111111-1111-4111-8111-111111111111")
        }
      >
        passkey created
      </button>
      <button onClick={onLocalPasskeyUnavailable}>passkey unavailable</button>
      {localRepair}
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
    setupProjectId: string | null;
    pairingState: "WAITING" | "ACTIVE" | "REJECTED" | "EXPIRED" | "UNAVAILABLE";
  }> = {},
) => ({
  data: {
    data: {
      nameComplete: false,
      browserSession: true,
      machineConnected: false,
      executionReady: false,
      hasProjects: false,
      setupProjectId: null,
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
        <Route
          path="/projects/:projectId/onboarding"
          element={<LocationProbe />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LocalSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetLocalPairing();
    sessionStorage.clear();
    localStorage.clear();
    authClient.getLocalSetupStatus.mockResolvedValue(statusResponse());
    listPasskeys.mockResolvedValue([]);
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

  it("spends the one-use handoff once when the page is remounted in development", async () => {
    authClient.completeLocalHandoff.mockResolvedValue({
      data: { data: { accessToken: "local-access-token" } },
    });
    window.history.replaceState({}, "", `/local#handoff=${HANDOFF_TOKEN}`);

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/local"]}>
          <Routes>
            <Route path="/local" element={<LocalSetupPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(acceptBrowserAuthSession).toHaveBeenCalledWith({
        accessToken: "local-access-token",
      });
    });
    expect(authClient.completeLocalHandoff).toHaveBeenCalledTimes(1);
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
    const spki = new Uint8Array([48, 89, 48, 19]);
    const binding = {
      enrollmentId: "550e8400-e29b-41d4-a716-446655440040",
      accountId: "account-1",
      organizationId: "organization-1",
      controllerCredentialId: "Y29udHJvbGxlcg",
      credentialPublicKeySpki: spki.buffer,
      registrationChallenge: "Y2hhbGxlbmdl",
    };
    expect(await computeLocalApprovalProof(secret, binding)).toBe(
      createHmac("sha256", Buffer.from(secret, "base64url"))
        .update(
          [
            "heyhey-local-approval-v2",
            binding.enrollmentId,
            binding.accountId,
            binding.organizationId,
            binding.controllerCredentialId,
            createHash("sha256").update(spki).digest("hex"),
            binding.registrationChallenge,
          ].join("\n"),
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

  it("hands the CLI's detected coding agents to the pairing screen and validates them once", async () => {
    const agents = {
      claude: "installed",
      codex: "not-found",
      opencode: "check-failed",
    };
    const secret = Buffer.alloc(32, 9).toString("base64url");
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({ nameComplete: true }),
    );
    window.history.replaceState(
      {},
      "",
      `/local?pairing=started#code=ABCDEFGHJK&approval=${secret}&agents=${encodeURIComponent(JSON.stringify(agents))}`,
    );
    renderLocalPage("/local?pairing=started");

    expect(await screen.findByTestId("claim-agents")).toHaveTextContent(
      JSON.stringify(agents),
    );
    expect(window.location.href).not.toContain("agents");

    cleanup();
    forgetLocalPairing();
    window.history.replaceState(
      {},
      "",
      `/local?pairing=started#code=ABCDEFGHJK&approval=${secret}&agents=${encodeURIComponent('{"claude":"nonsense"}')}`,
    );
    renderLocalPage("/local?pairing=started");
    expect(await screen.findByTestId("claim-agents")).toHaveTextContent("null");
  });

  it("after the passkey shows button-free progress and moves on by itself once the connection is live", async () => {
    const user = userEvent.setup();
    const secret = Buffer.alloc(32, 9).toString("base64url");
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({ nameComplete: true, machineConnected: false }),
    );
    window.history.replaceState(
      {},
      "",
      `/local?pairing=started#code=ABCDEFGHJK&approval=${secret}`,
    );
    renderLocalPage("/local?pairing=started");
    await user.click(await screen.findByText("passkey created"));

    const progress = await screen.findByTestId("local-pairing-progress");
    expect(progress.querySelector("button")).toBeNull();
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
    expect(screen.queryByTestId("local-pairing-progress-error")).toBeNull();

    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({ nameComplete: true, machineConnected: true }),
    );
    await waitFor(
      () => {
        expect(screen.getByTestId("location")).toHaveTextContent("/welcome");
      },
      { timeout: 5000 },
    );
  });

  it("shows an error and a retry only when connecting fails", async () => {
    const user = userEvent.setup();
    const secret = Buffer.alloc(32, 9).toString("base64url");
    authClient.getLocalSetupStatus
      .mockResolvedValueOnce(statusResponse({ nameComplete: true }))
      .mockRejectedValue(new Error("offline"));
    window.history.replaceState(
      {},
      "",
      `/local?pairing=started#code=ABCDEFGHJK&approval=${secret}`,
    );
    renderLocalPage("/local?pairing=started");
    await user.click(await screen.findByText("passkey created"));

    expect(
      await screen.findByTestId(
        "local-pairing-progress-error",
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({ nameComplete: true, machineConnected: true }),
    );
    await user.click(screen.getByTestId("local-pairing-progress-retry"));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/welcome");
    });
  });

  it("tells the person to check their terminal while connecting, and offers a retry when the CLI never connects", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const secret = Buffer.alloc(32, 9).toString("base64url");
      // The status request keeps succeeding: the CLI rejected the pairing or stopped.
      authClient.getLocalSetupStatus.mockResolvedValue(
        statusResponse({ nameComplete: true, machineConnected: false }),
      );
      window.history.replaceState(
        {},
        "",
        `/local?pairing=started#code=ABCDEFGHJK&approval=${secret}`,
      );
      renderLocalPage("/local?pairing=started");
      await user.click(await screen.findByText("passkey created"));

      expect(
        await screen.findByTestId("local-pairing-terminal-hint"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("local-pairing-progress-error")).toBeNull();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(
        await screen.findByTestId("local-pairing-progress-error"),
      ).toBeInTheDocument();

      await user.click(screen.getByTestId("local-pairing-progress-retry"));
      expect(screen.queryByTestId("local-pairing-progress-error")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["REJECTED", "EXPIRED", "UNAVAILABLE"] as const)(
    "ends the wait for a %s enrollment without offering to retry the dead claim",
    async (pairingState) => {
      const user = userEvent.setup();
      authClient.getLocalSetupStatus.mockResolvedValue(
        statusResponse({ nameComplete: true }),
      );
      window.history.replaceState(
        {},
        "",
        "/local?pairing=started#code=ABCDEFGHJK",
      );
      renderLocalPage("/local?pairing=started");
      await user.click(await screen.findByText("passkey created"));
      authClient.getLocalSetupStatus.mockResolvedValue(
        statusResponse({ nameComplete: true, pairingState }),
      );
      expect(
        await screen.findByTestId(
          "local-pairing-progress-error",
          {},
          { timeout: 5000 },
        ),
      ).toBeInTheDocument();
      expect(authClient.getLocalSetupStatus).toHaveBeenCalledWith({
        enrollmentId: "11111111-1111-4111-8111-111111111111",
      });
      expect(screen.queryByTestId("local-pairing-progress-retry")).toBeNull();
      expect(
        screen.queryByTestId("local-pairing-confirm-in-terminal"),
      ).toBeNull();
      expect(screen.queryByTestId("location")).toBeNull();
    },
  );

  it("bounds the wait when terminal pairing activates but the CLI never connects", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      authClient.getLocalSetupStatus.mockResolvedValue(
        statusResponse({ nameComplete: true, pairingState: "ACTIVE" }),
      );
      window.history.replaceState(
        {},
        "",
        "/local?pairing=started#code=ABCDEFGHJK",
      );
      renderLocalPage("/local?pairing=started");
      await user.click(await screen.findByText("passkey created"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(
        await screen.findByTestId("local-pairing-progress-error"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("location")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not skip a new pairing because an older computer is connected", async () => {
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({ nameComplete: true, machineConnected: true }),
    );
    window.history.replaceState(
      {},
      "",
      "/local?pairing=started#code=ABCDEFGHJK",
    );
    renderLocalPage("/local?pairing=started");
    expect(await screen.findByTestId("claim-machine")).toBeInTheDocument();
    expect(screen.queryByTestId("location")).toBeNull();
  });

  it("goes straight on for an already-connected computer without a button", async () => {
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({ nameComplete: true, machineConnected: true }),
    );
    renderLocalPage();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/welcome");
    });
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
    expect(screen.queryByTestId("local-pairing-progress")).toBeNull();
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

  it("resumes first-project setup on the project saved with the name once connected", async () => {
    const projectId = "550e8400-e29b-41d4-a716-446655440077";
    authClient.getLocalSetupStatus.mockResolvedValue(
      statusResponse({
        nameComplete: true,
        machineConnected: true,
        hasProjects: true,
        setupProjectId: projectId,
      }),
    );
    renderLocalPage();
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/welcome?projectId=${projectId}`,
      );
    });
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

  describe("on a computer that was set up before", () => {
    const openReturningPairing = () => {
      authClient.getLocalSetupStatus.mockResolvedValue(
        statusResponse({ nameComplete: true }),
      );
      listPasskeys.mockResolvedValue([{ id: "passkey-1" }]);
      // The CLI sends no approval secret once the account has a passkey.
      window.history.replaceState(
        {},
        "",
        "/local?pairing=started#code=ABCDEFGHJK",
      );
      renderLocalPage("/local?pairing=started");
    };

    it("says so, asks for the existing passkey, and sends the person to the terminal to confirm", async () => {
      const user = userEvent.setup();
      openReturningPairing();

      expect(
        await screen.findByRole("heading", { name: "Reconnect this computer" }),
      ).toBeVisible();
      expect(screen.getByTestId("claim-machine")).toHaveTextContent(
        "ABCDEFGHJK|",
      );
      await waitFor(() =>
        expect(screen.getByTestId("claim-returning")).toHaveTextContent("true"),
      );
      expect(screen.queryByTestId("local-repair")).not.toBeInTheDocument();

      await user.click(screen.getByText("passkey created"));

      expect(
        await screen.findByTestId("local-pairing-confirm-in-terminal"),
      ).toBeVisible();
    });

    it("offers one Repair when the passkey can't be used, waits for the terminal, then continues to a new first passkey", async () => {
      const user = userEvent.setup();
      authClient.requestLocalPasskeyRepair.mockResolvedValue({
        data: { data: { state: "REQUESTED" } },
      });
      authClient.getLocalPasskeyRepair.mockResolvedValue({
        data: { data: { state: "REQUESTED" } },
      });
      openReturningPairing();
      await waitFor(() =>
        expect(screen.getByTestId("claim-returning")).toHaveTextContent("true"),
      );

      await user.click(screen.getByText("passkey unavailable"));

      expect(
        await screen.findByTestId("local-repair-explanation"),
      ).toBeVisible();
      expect(authClient.requestLocalPasskeyRepair).not.toHaveBeenCalled();

      await user.click(screen.getByTestId("local-repair-action"));

      expect(
        await screen.findByTestId("local-repair-confirm-in-terminal"),
      ).toBeVisible();
      expect(screen.queryByTestId("local-repair-action")).toBeNull();

      authClient.getLocalPasskeyRepair.mockResolvedValue({
        data: { data: { state: "COMPLETED" } },
      });
      await waitFor(
        () =>
          expect(screen.getByTestId("claim-returning")).toHaveTextContent(
            "false",
          ),
        { timeout: 5000 },
      );
      expect(screen.queryByTestId("local-repair")).not.toBeInTheDocument();
    });

    it("shows a repair status failure and resumes when the API returns", async () => {
      const user = userEvent.setup();
      authClient.requestLocalPasskeyRepair.mockResolvedValue({
        data: { data: { state: "REQUESTED" } },
      });
      authClient.getLocalPasskeyRepair.mockRejectedValue(
        new Error("repair status unavailable"),
      );
      openReturningPairing();
      await user.click(await screen.findByText("passkey unavailable"));
      await user.click(screen.getByTestId("local-repair-action"));
      expect(
        await screen.findByTestId("local-repair-error", {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      authClient.getLocalPasskeyRepair.mockResolvedValue({
        data: { data: { state: "COMPLETED" } },
      });
      await waitFor(
        () =>
          expect(screen.getByTestId("claim-returning")).toHaveTextContent(
            "false",
          ),
        { timeout: 5000 },
      );
      expect(screen.queryByTestId("local-repair-error")).toBeNull();
    });

    it("says nothing changed when the repair is declined at the terminal and still offers it", async () => {
      const user = userEvent.setup();
      authClient.requestLocalPasskeyRepair.mockResolvedValue({
        data: { data: { state: "REQUESTED" } },
      });
      authClient.getLocalPasskeyRepair.mockResolvedValue({
        data: { data: { state: "DECLINED" } },
      });
      openReturningPairing();
      await waitFor(() =>
        expect(screen.getByTestId("claim-returning")).toHaveTextContent("true"),
      );
      await user.click(screen.getByText("passkey unavailable"));
      await user.click(await screen.findByTestId("local-repair-action"));

      expect(
        await screen.findByTestId(
          "local-repair-declined",
          {},
          { timeout: 5000 },
        ),
      ).toBeVisible();
      expect(screen.getByTestId("local-repair-action")).toBeVisible();
      expect(screen.getByTestId("claim-returning")).toHaveTextContent("true");
    });

    it("shows the API's own reason when a repair can't be started", async () => {
      const user = userEvent.setup();
      authClient.requestLocalPasskeyRepair.mockRejectedValue({
        response: {
          data: {
            message:
              "Repair can only start from the page heyhey local opens. Run heyhey local in your terminal to open it.",
            code: "LOCAL_REPAIR_SESSION_NOT_CLI_OPENED",
          },
        },
      });
      openReturningPairing();
      await waitFor(() =>
        expect(screen.getByTestId("claim-returning")).toHaveTextContent("true"),
      );
      await user.click(screen.getByText("passkey unavailable"));
      await user.click(await screen.findByTestId("local-repair-action"));

      expect(await screen.findByTestId("local-repair-error")).toHaveTextContent(
        "Repair can only start from the page heyhey local opens.",
      );
    });
  });
});
