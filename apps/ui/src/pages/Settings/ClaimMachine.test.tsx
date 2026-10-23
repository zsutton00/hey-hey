import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CurrentControllerMachineEligibilityState,
  MachineEnrollmentClaimFailureCode,
} from "@hey-hey/ui-common/api";
import { MachineEnrollmentClaimError } from "@hey-hey/ui-common/data";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaimMachine } from "./ClaimMachine";
import {
  WebAuthnCancelledError,
  WebAuthnUnsupportedError,
} from "./machineEnrollmentWebAuthn";

const mocks = vi.hoisted(() => ({
  beginMutate: vi.fn(),
  abandonMutate: vi.fn(),
  completeMutate: vi.fn(),
  createCredential: vi.fn(),
  refetchMachines: vi.fn(),
}));


type IdentityFixture = {
  userId: string;
  email: string;
  name: string;
  currentOrgId: string;
  orgMemberships: Array<{ orgId: string; role: string }>;
  isDevAdmin: boolean;
  devAdminMode: boolean;
  isTokenExpired: boolean;
  currentOrgRole: string | null;
};

const fixtures = vi.hoisted(() => ({
  identity: null as IdentityFixture | null,
  organization: null as { id: string; name: string } | null,
  organizationLoading: false,
  machines: [] as Array<{
    machineId: string;
    active: boolean;
    currentControllerEligibility: CurrentControllerMachineEligibilityState;
  }>,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  MachineEnrollmentClaimError: class MachineEnrollmentClaimError extends Error {
    code: string | null;

    constructor(
      message = "Unable to claim this enrollment.",
      serverError: { code?: string } | null = null
    ) {
      super(message);
      this.name = "MachineEnrollmentClaimError";
      this.code = serverError?.code ?? null;
    }
  },
  useAbandonMachineEnrollmentClaim: () => ({
    mutate: mocks.abandonMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useBeginMachineEnrollmentClaim: () => ({
    mutate: mocks.beginMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useCompleteMachineEnrollmentClaim: () => ({
    mutate: mocks.completeMutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  useUserPairedMachines: () => ({
    machines: fixtures.machines,
    refetch: mocks.refetchMachines,
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => fixtures.identity,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useOptionalOrganization: () => ({
    currentOrganization: fixtures.organization,
    loading: fixtures.organizationLoading,
  }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  HeyheyPairTerminalDemo: () => (
    <div data-testid="heyhey-pair-terminal">
      <span data-testid="heyhey-pair-terminal-command">heyhey pair</span>
      <button
        type="button"
        data-testid="heyhey-pair-terminal-copy"
        onClick={() => void navigator.clipboard.writeText("heyhey pair")}
      >
        Copy command
      </button>
    </div>
  ),
  TerminalScene: ({
    command,
    testIdPrefix,
  }: {
    command: string;
    testIdPrefix: string;
  }) => (
    <div data-testid={testIdPrefix}>
      <span data-testid={`${testIdPrefix}-command`}>{command}</span>
    </div>
  ),
}));

vi.mock("./machineEnrollmentWebAuthn", () => ({
  createMachineEnrollmentCredential: mocks.createCredential,
  WebAuthnCancelledError: class WebAuthnCancelledError extends Error {},
  WebAuthnUnsupportedError: class WebAuthnUnsupportedError extends Error {},
}));

const beginResult = {
  state: "claimable",
  enrollmentId: "enrollment-1",
  machineId: "machine-1",
  userId: "user-1",
  organizationId: "org-1",
  machineName: "Zac's MacBook",
  osFamily: "macos",
  cliVersion: "2.2.2",
  machineKeyFingerprint: "sha256:machine",
  controllerLabel: "Safari on Zac's MacBook",
  expiresAt: "2099-01-01T00:00:00.000Z",
  registrationOptions: {
    challenge: "challenge",
    rp: { id: "heyhey.dev", name: "Hey Hey" },
    user: { id: "user", name: "zac@example.com", displayName: "Zac" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: {
      userVerification: "required",
      residentKey: "preferred",
    },
    attestation: "none",
  },
};

const completeResult = {
  enrollmentId: "enrollment-1",
  machineId: "machine-1",
  organizationId: "org-1",
  state: "awaiting-machine-confirmation",
  credentialFingerprint: "sha256:credential",
  backupEligible: true,
  backupState: true,
  controllerLabel: "Safari on Zac's MacBook",
};

describe("ClaimMachine", () => {
  const enterPairingNames = (): void => {
    fireEvent.change(
      screen.getByTestId("settings-machine-claim-machine-name"),
      {
        target: { value: "  Zac's MacBook  " },
      }
    );
    fireEvent.change(
      screen.getByTestId("settings-machine-claim-controller-label"),
      { target: { value: "  Safari on Zac's MacBook  " } }
    );
  };

  const advancePastCliStep = (): void => {
    fireEvent.click(screen.getByTestId("settings-machine-claim-cli-done"));
    enterPairingNames();
  };

  const submitClaim = (): void => {
    enterPairingNames();
    fireEvent.click(screen.getByTestId("settings-machine-claim-begin"));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.identity = {
      userId: "user-1",
      name: "Zac",
      email: "zac@example.com",
      currentOrgId: "org-1",
      orgMemberships: [{ orgId: "org-1", role: "member" }],
      isDevAdmin: false,
      devAdminMode: false,
      isTokenExpired: false,
      currentOrgRole: "member",
    };
    fixtures.organization = { id: "org-1", name: "Hey Hey" };
    fixtures.organizationLoading = false;
    fixtures.machines = [];
    beginResult.userId = "user-1";
    beginResult.organizationId = "org-1";
    beginResult.machineId = "machine-1";
    beginResult.machineName = "Zac's MacBook";
    beginResult.expiresAt = "2099-01-01T00:00:00.000Z";
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: { create: vi.fn() },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    mocks.beginMutate.mockResolvedValue(beginResult);
    mocks.abandonMutate.mockResolvedValue({
      enrollmentId: "enrollment-1",
      state: "rejected",
    });
    mocks.createCredential.mockResolvedValue({
      id: "credential-id",
      rawId: "raw-id",
      type: "public-key",
      response: {
        clientDataJSON: "client-data",
        attestationObject: "attestation",
        transports: new Set(["internal"]),
      },
      authenticatorAttachment: "platform",
    });
    mocks.completeMutate.mockResolvedValue(completeResult);
  });

  it("keeps the five pairing steps visible and advances only after CLI acknowledgement", async () => {
    render(<ClaimMachine initialCode={null} />);

    expect(
      screen.getByText("Run the Agent Bridge command")
    ).toBeInTheDocument();
    expect(screen.getByText("Enter the pairing code")).toBeInTheDocument();
    expect(screen.getByText("Create a passkey")).toBeInTheDocument();
    expect(screen.getByText("Confirm in the Agent Bridge")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(
      screen.getByTestId("heyhey-pair-terminal-command")
    ).toHaveTextContent("heyhey pair");

    fireEvent.click(screen.getByTestId("heyhey-pair-terminal-copy"));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("heyhey pair")
    );
    expect(
      screen.queryByTestId("settings-machine-claim-code-entry")
    ).not.toBeInTheDocument();

    advancePastCliStep();

    expect(
      screen.getByTestId("settings-machine-claim-code-entry")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Run the Agent Bridge command").closest(".Mui-completed")
    ).not.toBeNull();
  });

  it("uses the existing-machine controller command for browser authorization", () => {
    render(
      <ClaimMachine
        initialCode={null}
        authorizationTarget={{
          machineId: "machine-1",
          machineName: "Zac's MacBook",
        }}
      />
    );

    expect(
      screen.getByText("Authorize this browser for Zac's MacBook")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("authorize-browser-terminal-command")
    ).toHaveTextContent("heyhey controllers add");
    fireEvent.click(screen.getByTestId("settings-machine-claim-cli-done"));
    expect(
      screen.queryByTestId("settings-machine-claim-machine-name")
    ).not.toBeInTheDocument();
  });

  it("opens the explicit existing-machine controller journey without a machine name", () => {
    render(
      <ClaimMachine initialCode={null} journey="existing-machine" />
    );

    expect(
      screen.getByText("Add a controller")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("add-controller-terminal-command")
    ).toHaveTextContent("heyhey controllers add");

    fireEvent.click(screen.getByTestId("settings-machine-claim-cli-done"));

    expect(
      screen.queryByTestId("settings-machine-claim-machine-name")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("settings-machine-claim-controller-label")
    ).toBeInTheDocument();
  });

  it("uses authenticated claim details as the existing machine evidence", async () => {
    render(
      <ClaimMachine
        initialCode="BCDFG-HJKLM"
        journey="existing-machine"
      />
    );

    expect(
      screen.queryByTestId("settings-machine-claim-machine-name")
    ).not.toBeInTheDocument();
    fireEvent.change(
      screen.getByTestId("settings-machine-claim-controller-label"),
      { target: { value: "This browser" } }
    );
    fireEvent.click(screen.getByTestId("settings-machine-claim-begin"));

    await waitFor(() =>
      expect(mocks.beginMutate).toHaveBeenCalledWith({
        organizationId: "org-1",
        userCode: "BCDFGHJKLM",
        controllerLabel: "This browser",
      })
    );
    expect(
      await screen.findByTestId("settings-machine-claim-review")
    ).toBeInTheDocument();
    expect(screen.getByText("Zac's MacBook")).toBeInTheDocument();
    expect(screen.getByText("macOS")).toBeInTheDocument();
    expect(screen.getByText("2.2.2")).toBeInTheDocument();
    expect(screen.getByText("sha256:machine")).toBeInTheDocument();
  });

  it("rejects an enrollment code for a different authorization target", async () => {
    beginResult.machineId = "machine-2";
    beginResult.machineName = "Another Mac";
    render(
      <ClaimMachine
        initialCode="BCDFG-HJKLM"
        authorizationTarget={{
          machineId: "machine-1",
          machineName: "Zac's MacBook",
        }}
      />
    );
    fireEvent.change(
      screen.getByTestId("settings-machine-claim-controller-label"),
      { target: { value: "This browser" } }
    );
    fireEvent.click(screen.getByTestId("settings-machine-claim-begin"));

    await waitFor(() =>
      expect(mocks.abandonMutate).toHaveBeenCalledWith({
        enrollmentId: "enrollment-1",
        organizationId: "org-1",
      })
    );
    expect(
      screen.getByText(/belongs to another Agent Bridge/)
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-machine-claim-review")
    ).not.toBeInTheDocument();
  });

  it("requires explicit non-empty machine and passkey names", () => {
    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);

    expect(
      screen.getByTestId("settings-machine-claim-machine-name")
    ).toHaveValue("");
    expect(
      screen.getByTestId("settings-machine-claim-machine-name")
    ).toHaveAttribute("placeholder", "My laptop");
    expect(
      screen.getByTestId("settings-machine-claim-controller-label")
    ).toHaveValue("");
    expect(
      screen.getByTestId("settings-machine-claim-controller-label")
    ).toHaveAttribute("placeholder", "Chrome on my laptop");

    fireEvent.click(screen.getByTestId("settings-machine-claim-begin"));
    expect(
      screen.getByText("Enter a name for this Agent Bridge.")
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByTestId("settings-machine-claim-machine-name"),
      {
        target: { value: "Zac's MacBook" },
      }
    );
    fireEvent.change(
      screen.getByTestId("settings-machine-claim-controller-label"),
      { target: { value: "   " } }
    );
    fireEvent.click(screen.getByTestId("settings-machine-claim-begin"));

    expect(
      screen.getByText("Enter a label for this browser passkey.")
    ).toBeInTheDocument();
    expect(mocks.beginMutate).not.toHaveBeenCalled();
  });

  it("normalizes the displayed code and waits for review before native WebAuthn", async () => {
    render(<ClaimMachine initialCode={null} />);
    advancePastCliStep();

    fireEvent.change(screen.getByTestId("settings-machine-claim-code"), {
      target: { value: "bcdfg-hjklm" },
    });
    submitClaim();

    await waitFor(() =>
      expect(mocks.beginMutate).toHaveBeenCalledWith({
        organizationId: "org-1",
        userCode: "BCDFGHJKLM",
        controllerLabel: "Safari on Zac's MacBook",
      })
    );
    expect(mocks.createCredential).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("settings-machine-claim-review")
    ).toBeInTheDocument();
    expect(screen.getByText("Zac's MacBook")).toBeInTheDocument();
    expect(screen.getByText("Safari on Zac's MacBook")).toBeInTheDocument();
    expect(screen.getByText("Zac (zac@example.com)")).toBeInTheDocument();
    expect(screen.getByText("Hey Hey (org-1)")).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("settings-machine-claim-create-passkey")
    );

    await waitFor(() =>
      expect(mocks.createCredential).toHaveBeenCalledTimes(1)
    );
    await waitFor(() =>
      expect(mocks.completeMutate).toHaveBeenCalledWith({
        enrollmentId: "enrollment-1",
        organizationId: "org-1",
        credential: expect.objectContaining({ id: "credential-id" }),
      })
    );
  });

  it("preserves the display hyphen in a query-seeded journey and normalizes claim validation", async () => {
    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);

    expect(
      screen.getByTestId("settings-machine-claim-code-entry")
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-machine-claim-code")).toHaveValue(
      "BCDFG-HJKLM"
    );
    expect(
      screen.getByText("Run the Agent Bridge command").closest(".Mui-completed")
    ).not.toBeNull();

    submitClaim();

    await waitFor(() =>
      expect(mocks.beginMutate).toHaveBeenCalledWith({
        organizationId: "org-1",
        userCode: "BCDFGHJKLM",
        controllerLabel: "Safari on Zac's MacBook",
      })
    );
    expect(
      screen.getByTestId("settings-machine-claim-review")
    ).toBeInTheDocument();
    expect(mocks.createCredential).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty query value", ""],
    ["an invalid query value", "not-a-code"],
  ])("keeps %s at safe code entry", (_label, initialCode) => {
    render(<ClaimMachine initialCode={initialCode} />);

    expect(
      screen.getByTestId("settings-machine-claim-code-entry")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-machine-claim-begin"));

    expect(
      screen.getByText("Enter the 10-character code from your CLI.")
    ).toBeInTheDocument();
    expect(mocks.beginMutate).not.toHaveBeenCalled();
    expect(mocks.createCredential).not.toHaveBeenCalled();
  });

  it("preserves a query-seeded enrollment when this browser lacks passkey support", () => {
    Object.defineProperty(navigator, "credentials", {
      configurable: true,
      value: undefined,
    });

    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);

    expect(
      screen.getByTestId("settings-machine-claim-unsupported")
    ).toHaveTextContent("Your current CLI enrollment remains valid");
    expect(
      screen.queryByText(/start a fresh cli enrollment/i)
    ).not.toBeInTheDocument();
    expect(mocks.beginMutate).not.toHaveBeenCalled();
  });

  it("keeps the entered code available after a begin failure so it can be retried", async () => {
    mocks.beginMutate
      .mockRejectedValueOnce(new Error("Unable to claim this enrollment."))
      .mockResolvedValueOnce(beginResult);
    render(<ClaimMachine initialCode={null} />);
    advancePastCliStep();

    fireEvent.change(screen.getByTestId("settings-machine-claim-code"), {
      target: { value: "BCDFG-HJKLM" },
    });
    submitClaim();

    await waitFor(() => expect(mocks.beginMutate).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText("Unable to claim this enrollment.")
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-machine-claim-code")).toHaveValue(
      "BCDFG-HJKLM"
    );

    submitClaim();

    expect(
      await screen.findByTestId("settings-machine-claim-review")
    ).toBeInTheDocument();
    expect(mocks.beginMutate).toHaveBeenCalledTimes(2);
  });

  it("renders API-authored generic guidance without offering a fresh start", async () => {
    const message = "Unable to claim this enrollment.";
    mocks.beginMutate.mockRejectedValue(
      new MachineEnrollmentClaimError(message, {
        success: false,
        message,
        code: MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimUnavailable,
        data: null,
        timestamp: "2099-01-01T00:00:00.000Z",
        statusCode: 400,
        path: "/api/v1/machines/enrollments/claim/begin",
      })
    );
    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);

    submitClaim();

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByTestId("settings-machine-claim-code")).toHaveValue(
      "BCDFG-HJKLM"
    );
    expect(
      screen.queryByRole("button", { name: "Try a new code" })
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimExpired,
      "This enrollment has expired. Start a fresh enrollment from the CLI.",
    ],
    [
      MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimTerminal,
      "This enrollment can no longer be claimed. Start a fresh enrollment from the CLI.",
    ],
  ])(
    "offers a fresh start only for API-authored %s outcomes",
    async (code, message) => {
      mocks.beginMutate.mockRejectedValue(
        new MachineEnrollmentClaimError(message, {
          success: false,
          message,
          code,
          data: null,
          timestamp: "2099-01-01T00:00:00.000Z",
          statusCode: 400,
          path: "/api/v1/machines/enrollments/claim/begin",
        })
      );
      render(<ClaimMachine initialCode="BCDFG-HJKLM" />);

      submitClaim();

      expect(
        await screen.findByTestId("settings-machine-claim-expired")
      ).toHaveTextContent(message);
      expect(
        screen.getByRole("button", { name: "Try a new code" })
      ).toBeInTheDocument();
    }
  );

  it("blocks passkey creation when the claim expiration is invalid", async () => {
    beginResult.expiresAt = "not-a-date";
    render(<ClaimMachine initialCode={null} />);
    advancePastCliStep();

    fireEvent.change(screen.getByTestId("settings-machine-claim-code"), {
      target: { value: "BCDFG-HJKLM" },
    });
    fireEvent.click(screen.getByTestId("settings-machine-claim-begin"));

    await waitFor(() =>
      expect(
        screen.getByTestId("settings-machine-claim-expired")
      ).toBeInTheDocument()
    );
    expect(mocks.createCredential).not.toHaveBeenCalled();
    expect(mocks.completeMutate).not.toHaveBeenCalled();
  });

  it("shows the awaiting-local-confirmation result without treating the machine as active", async () => {
    render(<ClaimMachine initialCode={null} />);
    advancePastCliStep();
    fireEvent.change(screen.getByTestId("settings-machine-claim-code"), {
      target: { value: "BCDFG-HJKLM" },
    });
    fireEvent.click(screen.getByTestId("settings-machine-claim-begin"));
    await waitFor(() =>
      expect(
        screen.getByTestId("settings-machine-claim-review")
      ).toBeInTheDocument()
    );
    fireEvent.click(
      screen.getByTestId("settings-machine-claim-create-passkey")
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("settings-machine-claim-success")
      ).toBeInTheDocument()
    );
    expect(screen.getByText("Awaiting local confirmation")).toBeInTheDocument();
    expect(
      screen.getByText(/not active until the CLI confirms locally/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/return to the terminal where you ran/i)
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("controller-authorization-terminal-command")
    ).toHaveTextContent("Authorize this controller on this machine? [y/N]");
    expect(
      screen.getByText("Confirm in the Agent Bridge").closest(".Mui-active")
    ).not.toBeNull();
  });

  it("advances to completion only after this controller becomes eligible", async () => {
    const onCompletionAction = vi.fn();
    const { rerender } = render(
      <ClaimMachine
        initialCode="BCDFG-HJKLM"
        completionActionLabel="Go somewhere"
        onCompletionAction={onCompletionAction}
      />
    );
    submitClaim();
    await screen.findByTestId("settings-machine-claim-review");
    fireEvent.click(
      screen.getByTestId("settings-machine-claim-create-passkey")
    );
    await screen.findByTestId("settings-machine-claim-success");

    expect(
      screen.queryByTestId("settings-machine-claim-complete")
    ).not.toBeInTheDocument();

    fixtures.machines = [
      {
        machineId: "machine-1",
        active: true,
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.NotEnrolled,
      },
    ];
    rerender(
      <ClaimMachine
        initialCode="BCDFG-HJKLM"
        completionActionLabel="Go somewhere"
        onCompletionAction={onCompletionAction}
      />
    );

    expect(
      screen.queryByTestId("settings-machine-claim-complete")
    ).not.toBeInTheDocument();

    fixtures.machines = [
      {
        machineId: "machine-1",
        active: true,
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
      },
    ];
    rerender(
      <ClaimMachine
        initialCode="BCDFG-HJKLM"
        completionActionLabel="Go somewhere"
        onCompletionAction={onCompletionAction}
      />
    );

    expect(
      await screen.findByTestId("settings-machine-claim-complete")
    ).toBeInTheDocument();
    expect(screen.getByText("Complete").closest(".Mui-active")).not.toBeNull();
    fireEvent.click(
      screen.getByTestId("settings-machine-claim-completion-action")
    );
    expect(onCompletionAction).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "cancellation",
      new WebAuthnCancelledError(),
      "Passkey creation was cancelled. Try again when you are ready.",
    ],
    [
      "unsupported WebAuthn",
      new WebAuthnUnsupportedError(),
      "This browser could not open passkey creation. Try again, or cancel to use a different browser.",
    ],
    [
      "credential failure",
      new Error("credential failed"),
      "The browser could not create the passkey. Try again.",
    ],
  ])(
    "retains the browser claim and offers an in-place retry after %s",
    async (_label, error, expectedMessage) => {
      mocks.createCredential
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({
          id: "credential-id",
          rawId: "raw-id",
          type: "public-key",
          response: {
            clientDataJSON: "client-data",
            attestationObject: "attestation",
            transports: new Set(["internal"]),
          },
          authenticatorAttachment: "platform",
        });
      render(<ClaimMachine initialCode="BCDFG-HJKLM" />);
      submitClaim();
      await waitFor(() =>
        expect(
          screen.getByTestId("settings-machine-claim-review")
        ).toBeInTheDocument()
      );

      fireEvent.click(
        screen.getByTestId("settings-machine-claim-create-passkey")
      );

      expect(
        await screen.findByTestId("settings-machine-claim-passkey-retry")
      ).toHaveTextContent(expectedMessage);
      expect(mocks.abandonMutate).not.toHaveBeenCalled();
      expect(
        screen.getByTestId("settings-machine-claim-review")
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Try creating passkey again" })
      );

      expect(
        await screen.findByTestId("settings-machine-claim-success")
      ).toBeInTheDocument();
      expect(mocks.createCredential).toHaveBeenCalledTimes(2);
    }
  );

  it("terminalizes the browser claim when review is cancelled", async () => {
    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);
    submitClaim();
    await waitFor(() =>
      expect(
        screen.getByTestId("settings-machine-claim-review")
      ).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId("settings-machine-claim-cancel"));

    await waitFor(() =>
      expect(mocks.abandonMutate).toHaveBeenCalledWith({
        enrollmentId: "enrollment-1",
        organizationId: "org-1",
      })
    );
    expect(
      await screen.findByTestId("settings-machine-claim-cancelled")
    ).toBeInTheDocument();
  });

  it("retains the browser claim and retries after a completion failure", async () => {
    mocks.completeMutate
      .mockRejectedValueOnce(new Error("Unable to claim this enrollment."))
      .mockResolvedValueOnce(completeResult);
    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);
    submitClaim();
    await waitFor(() =>
      expect(
        screen.getByTestId("settings-machine-claim-review")
      ).toBeInTheDocument()
    );

    fireEvent.click(
      screen.getByTestId("settings-machine-claim-create-passkey")
    );

    await waitFor(() => expect(mocks.completeMutate).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByTestId("settings-machine-claim-passkey-retry")
    ).toHaveTextContent("Unable to claim this enrollment.");
    expect(
      screen.getByText("Unable to claim this enrollment.")
    ).toBeInTheDocument();
    expect(mocks.abandonMutate).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Try creating passkey again" })
    );

    expect(
      await screen.findByTestId("settings-machine-claim-success")
    ).toBeInTheDocument();
    expect(mocks.completeMutate).toHaveBeenCalledTimes(2);
  });

  it("never surfaces claim-cleanup failures after explicit cancellation", async () => {
    mocks.abandonMutate.mockRejectedValue(new Error("close failed"));
    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);
    submitClaim();
    await waitFor(() =>
      expect(
        screen.getByTestId("settings-machine-claim-review")
      ).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("settings-machine-claim-cancel"));

    expect(
      await screen.findByTestId("settings-machine-claim-cancelled")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start over" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/do not start a fresh cli enrollment/i)
    ).not.toBeInTheDocument();
    expect(mocks.abandonMutate).toHaveBeenCalledTimes(1);
  });

  it("allows a terminally expired claim to start fresh when abandonment cannot respond", async () => {
    const initialNow = Date.parse("2026-08-24T18:00:00.000Z");
    const expiresAt = initialNow + 1_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(initialNow);
    beginResult.expiresAt = new Date(expiresAt).toISOString();
    mocks.abandonMutate.mockImplementation(async () => {
      now.mockReturnValue(expiresAt);
      throw new Error("close response unavailable");
    });

    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);
    submitClaim();
    await screen.findByTestId("settings-machine-claim-review");
    fireEvent.click(screen.getByTestId("settings-machine-claim-cancel"));

    expect(
      await screen.findByTestId("settings-machine-claim-expired")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-machine-claim-abandon-failed")
    ).not.toBeInTheDocument();
    now.mockRestore();
  });

  it("retains an active claim without fresh-start guidance when identity becomes unavailable", async () => {
    const { rerender } = render(<ClaimMachine initialCode="BCDFG-HJKLM" />);
    submitClaim();
    await screen.findByTestId("settings-machine-claim-review");

    fixtures.identity = { ...fixtures.identity!, isTokenExpired: true };
    rerender(<ClaimMachine initialCode="BCDFG-HJKLM" />);

    expect(
      screen.getByTestId("settings-machine-claim-identity-blocked")
    ).toHaveTextContent("The previous browser claim is still open");
    expect(
      screen.queryByRole("button", { name: "Start a fresh enrollment" })
    ).not.toBeInTheDocument();

    fixtures.identity = { ...fixtures.identity!, isTokenExpired: false };
    rerender(<ClaimMachine initialCode="BCDFG-HJKLM" />);
    fireEvent.click(screen.getByTestId("settings-machine-claim-cancel"));

    expect(
      await screen.findByTestId("settings-machine-claim-cancelled")
    ).toBeInTheDocument();
    expect(mocks.abandonMutate).toHaveBeenCalledWith({
      enrollmentId: "enrollment-1",
      organizationId: "org-1",
    });
  });

  it("routes an already completed same-claimant attempt to local confirmation", async () => {
    mocks.beginMutate.mockResolvedValue({
      state: "awaiting-machine-confirmation",
      enrollmentId: "enrollment-1",
      machineId: "machine-1",
      userId: "user-1",
      organizationId: "org-1",
      controllerLabel: "Safari on Zac's MacBook",
      expiresAt: "2099-01-01T00:00:00.000Z",
      credentialFingerprint: "sha256:credential",
      backupEligible: true,
      backupState: false,
    });
    render(<ClaimMachine initialCode="BCDFG-HJKLM" />);

    submitClaim();

    expect(
      await screen.findByTestId("settings-machine-claim-success")
    ).toBeInTheDocument();
    expect(mocks.createCredential).not.toHaveBeenCalled();
  });

  it("replaces attempt-local display state when the URL supplies a newer code", async () => {
    const { rerender } = render(<ClaimMachine initialCode="BCDFG-HJKLM" />);
    submitClaim();
    await screen.findByTestId("settings-machine-claim-review");

    rerender(<ClaimMachine initialCode="NPQRS-TVWXZ" />);

    expect(
      screen.getByTestId("settings-machine-claim-code-entry")
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-machine-claim-code")).toHaveValue(
      "NPQRS-TVWXZ"
    );
    expect(mocks.abandonMutate).not.toHaveBeenCalled();
  });

  it("ignores an older begin response after the URL supplies a newer code", async () => {
    let resolveOlderBegin: ((value: typeof beginResult) => void) | undefined;
    mocks.beginMutate.mockReturnValueOnce(
      new Promise<typeof beginResult>((resolve) => {
        resolveOlderBegin = resolve;
      })
    );
    const { rerender } = render(<ClaimMachine initialCode="BCDFG-HJKLM" />);
    submitClaim();
    await waitFor(() => expect(mocks.beginMutate).toHaveBeenCalledTimes(1));

    rerender(<ClaimMachine initialCode="NPQRS-TVWXZ" />);
    resolveOlderBegin?.(beginResult);

    await waitFor(() =>
      expect(screen.getByTestId("settings-machine-claim-code")).toHaveValue(
        "NPQRS-TVWXZ"
      )
    );
    expect(
      screen.getByTestId("settings-machine-claim-code-entry")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-machine-claim-review")
    ).not.toBeInTheDocument();
  });

  it("blocks the claim journey while authenticated identity is unavailable", () => {
    fixtures.identity = null;

    render(<ClaimMachine initialCode={null} />);

    expect(
      screen.getByTestId("settings-machine-claim-identity-blocked")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-machine-claim-code-entry")
    ).not.toBeInTheDocument();
    expect(mocks.beginMutate).not.toHaveBeenCalled();
    expect(mocks.createCredential).not.toHaveBeenCalled();
  });

  it("blocks the claim journey while the selected organization is loading", () => {
    fixtures.organizationLoading = true;

    render(<ClaimMachine initialCode={null} />);

    expect(
      screen.getByTestId("settings-machine-claim-identity-blocked")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-machine-claim-code-entry")
    ).not.toBeInTheDocument();
  });

  it.each([
    ["an expired identity", { isTokenExpired: true }],
    ["an absent organization membership", { orgMemberships: [] }],
  ] as const)("blocks the claim journey for %s", (_label, changes) => {
    fixtures.identity = { ...fixtures.identity!, ...changes };

    render(<ClaimMachine initialCode={null} />);

    expect(
      screen.getByTestId("settings-machine-claim-identity-blocked")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-machine-claim-code-entry")
    ).not.toBeInTheDocument();
    expect(mocks.beginMutate).not.toHaveBeenCalled();
  });

  it.each([
    ["the authenticated account", { userId: "user-2" }],
    ["the selected organization", { organizationId: "org-2" }],
  ] as const)(
    "blocks review when begin-claim returns a different %s",
    async (_label, mismatch) => {
      Object.assign(beginResult, mismatch);
      render(<ClaimMachine initialCode={null} />);
      advancePastCliStep();

      fireEvent.change(screen.getByTestId("settings-machine-claim-code"), {
        target: { value: "BCDFG-HJKLM" },
      });
      submitClaim();

      await waitFor(() =>
        expect(mocks.beginMutate).toHaveBeenCalledWith({
          organizationId: "org-1",
          userCode: "BCDFGHJKLM",
          controllerLabel: "Safari on Zac's MacBook",
        })
      );
      expect(
        screen.getByTestId("settings-machine-claim-identity-blocked")
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("settings-machine-claim-review")
      ).not.toBeInTheDocument();
      expect(mocks.createCredential).not.toHaveBeenCalled();
      expect(mocks.completeMutate).not.toHaveBeenCalled();
    }
  );
});
