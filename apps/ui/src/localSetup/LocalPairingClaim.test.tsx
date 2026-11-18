import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserResponseDto } from "@hey-hey/ui-common/api";
import { LocalPairingClaim } from "./LocalPairingClaim";
import {
  adoptSetupSession,
  forgetSetupSession,
  getSetupSession,
} from "./setupSession";

const mocks = vi.hoisted(() => ({
  beginMutate: vi.fn(),
  abandonMutate: vi.fn(),
  completeMutate: vi.fn(),
  createCredential: vi.fn(),
  requestProof: vi.fn(),
  getMyOrganizations: vi.fn(),
}));

const mutation = (mutate: unknown) => ({
  mutate,
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
});

vi.mock("@hey-hey/ui-common/data", () => ({
  MachineEnrollmentClaimError: class MachineEnrollmentClaimError extends Error {
    code: string | null;

    constructor(
      message = "Unable to claim this enrollment.",
      serverError: { code?: string } | null = null,
    ) {
      super(message);
      this.name = "MachineEnrollmentClaimError";
      this.code = serverError?.code ?? null;
    }
  },
  useAbandonMachineEnrollmentClaim: () => mutation(mocks.abandonMutate),
  useBeginMachineEnrollmentClaim: () => mutation(mocks.beginMutate),
  useCompleteMachineEnrollmentClaim: () => mutation(mocks.completeMutate),
}));

vi.mock("@hey-hey/ui-common/clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/clients")>()),
  getApiRuntime: () => ({
    clients: {
      organizations: { getMyOrganizations: mocks.getMyOrganizations },
    },
  }),
}));

vi.mock("@hey-hey/ui-common/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/services")>()),
  requestRegistrationProof: mocks.requestProof,
}));

vi.mock("../pages/Settings/machineEnrollmentWebAuthn", () => ({
  createMachineEnrollmentCredential: mocks.createCredential,
  WebAuthnCancelledError: class WebAuthnCancelledError extends Error {},
  WebAuthnUnsupportedError: class WebAuthnUnsupportedError extends Error {},
}));

const user = {
  id: "user-1",
  email: "local-user@installation.invalid",
  name: "Ada",
  isActive: true,
  isLocalAccount: true,
  currentOrganizationId: "org-1",
  createdAt: "2026-11-02T00:00:00Z",
  updatedAt: "2026-11-02T00:00:00Z",
} as UserResponseDto;

const beginResult = {
  state: "claimable",
  enrollmentId: "enrollment-1",
  machineId: "machine-1",
  userId: "user-1",
  organizationId: "org-1",
  machineName: "Ada's MacBook",
  osFamily: "macos",
  cliVersion: "2.2.2",
  machineKeyFingerprint: "sha256:machine",
  controllerLabel: "Passkey on this computer",
  enrollmentMode: "SHARED_NEW",
  expiresAt: "2099-01-01T00:00:00.000Z",
  registrationOptions: { challenge: "challenge" },
};

const completeResult = {
  enrollmentId: "enrollment-1",
  machineId: "machine-1",
  organizationId: "org-1",
  state: "awaiting-machine-confirmation",
  credentialFingerprint: "sha256:credential",
  backupEligible: true,
  backupState: true,
  controllerLabel: "Passkey on this computer",
};

const replacementSession = {
  accessToken: "replacement-access-token",
  expiresIn: 900,
  user,
};

const renderPairing = (
  overrides: Partial<React.ComponentProps<typeof LocalPairingClaim>> = {},
) =>
  render(
    <LocalPairingClaim
      code="BCDFG-HJKLM"
      approvalSecret={Buffer.alloc(32, 7).toString("base64url")}
      agents={{
        claude: "installed",
        codex: "not-found",
        opencode: "not-found",
      }}
      user={user}
      returning={false}
      onPasskeyCreated={vi.fn()}
      onPasskeyUnavailable={vi.fn()}
      onAccountProofRequired={vi.fn()}
      repair={null}
      {...overrides}
    />,
  );

const waitUntilReady = () =>
  waitFor(() =>
    expect(screen.getByTestId("local-pairing-create-passkey")).toBeEnabled(),
  );

describe("LocalPairingClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetSetupSession();
    adoptSetupSession({ accessToken: "setup-token", expiresIn: 900, user });
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: vi.fn() },
    });
    mocks.getMyOrganizations.mockResolvedValue({
      data: { data: [{ id: "org-1", name: "Ada's workspace" }] },
    });
    mocks.beginMutate.mockResolvedValue(beginResult);
    mocks.createCredential.mockResolvedValue({
      credential: { id: "credential-id", rawId: "raw-id", type: "public-key" },
      publicKeySpki: new Uint8Array([48, 89, 1, 2]).buffer,
    });
    mocks.completeMutate.mockResolvedValue({
      ...completeResult,
      session: replacementSession,
    });
  });

  it("is one screen with the agents found, then one shared passkey with the CLI-verifiable proof that becomes setup's session", async () => {
    const onPasskeyCreated = vi.fn();
    renderPairing({ onPasskeyCreated });

    // The enrollment is prepared on its own; there is no code to enter or review page.
    await waitUntilReady();
    expect(
      screen.queryByTestId("settings-machine-claim-code"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("local-pairing-agent-claude"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("local-pairing-technical")).toHaveTextContent(
      "Ada's workspace (org-1)",
    );
    expect(mocks.beginMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        userCode: "BCDFGHJKLM",
        enrollmentMode: "SHARED_NEW",
        firstLocalGrant: { cadence: "ONE_MONTH" },
      }),
    );

    // The passkey challenge commits to the duration, so choosing another prepares the claim again.
    fireEvent.click(screen.getByTestId("local-pairing-duration-ONE_WEEK"));
    await waitFor(() =>
      expect(mocks.beginMutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ firstLocalGrant: { cadence: "ONE_WEEK" } }),
      ),
    );
    await waitUntilReady();

    fireEvent.click(screen.getByTestId("local-pairing-create-passkey"));

    await waitFor(() =>
      expect(onPasskeyCreated).toHaveBeenCalledWith("enrollment-1"),
    );
    expect(mocks.createCredential).toHaveBeenCalledTimes(1);
    expect(mocks.requestProof).not.toHaveBeenCalled();
    const completion = mocks.completeMutate.mock.calls[0]![0];
    expect(completion).toMatchObject({
      enrollmentId: "enrollment-1",
      localApprovalProof: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(completion).not.toHaveProperty("accountProof");
    expect(getSetupSession()?.accessToken).toBe("replacement-access-token");
  });

  it("blocks passkey creation when the session's organization isn't one the account belongs to", async () => {
    mocks.getMyOrganizations.mockResolvedValue({
      data: { data: [{ id: "org-2", name: "Someone else's" }] },
    });
    renderPairing();

    expect(
      await screen.findByTestId("settings-machine-claim-identity-blocked"),
    ).toBeVisible();
    expect(mocks.beginMutate).not.toHaveBeenCalled();
  });

  it("blocks passkey creation once the setup session's access has lapsed", async () => {
    adoptSetupSession({ accessToken: "setup-token", expiresIn: 0, user });
    renderPairing();

    expect(
      await screen.findByTestId("settings-machine-claim-identity-blocked"),
    ).toBeVisible();
    expect(mocks.beginMutate).not.toHaveBeenCalled();
  });

  describe("on a computer that was set up before", () => {
    it("pairs with proof from the existing passkey and asks for no access duration", async () => {
      const accountProof = { passkeyAssertion: { id: "existing-passkey" } };
      mocks.requestProof.mockResolvedValue(accountProof);
      renderPairing({ approvalSecret: null, returning: true });

      await waitUntilReady();
      expect(screen.getByTestId("local-pairing-returning")).toBeVisible();
      expect(
        screen.queryByTestId("local-pairing-duration"),
      ).not.toBeInTheDocument();
      // The terminal confirms this pairing, so it asks for no pairing-time grant.
      expect(mocks.beginMutate.mock.calls[0]![0]).not.toHaveProperty(
        "firstLocalGrant",
      );

      fireEvent.click(screen.getByTestId("local-pairing-create-passkey"));

      await waitFor(() => expect(mocks.completeMutate).toHaveBeenCalled());
      expect(mocks.requestProof).toHaveBeenCalledWith({ kind: "passkey" });
      expect(mocks.completeMutate).toHaveBeenCalledWith(
        expect.objectContaining({ accountProof }),
      );
      expect(mocks.completeMutate.mock.calls[0]![0]).not.toHaveProperty(
        "localApprovalProof",
      );
    });

    it("reports an existing passkey that can't be produced instead of creating a new one", async () => {
      const onPasskeyUnavailable = vi.fn();
      mocks.requestProof.mockRejectedValue(new Error("NotAllowedError"));
      renderPairing({
        approvalSecret: null,
        returning: true,
        onPasskeyUnavailable,
        repair: <p data-testid="repair-slot">repair</p>,
      });

      await waitUntilReady();
      fireEvent.click(screen.getByTestId("local-pairing-create-passkey"));

      await waitFor(() => expect(onPasskeyUnavailable).toHaveBeenCalled());
      expect(mocks.createCredential).not.toHaveBeenCalled();
      expect(mocks.completeMutate).not.toHaveBeenCalled();
      expect(screen.getByTestId("repair-slot")).toBeVisible();
    });
  });
});
