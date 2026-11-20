import { useEffect, useRef, useState } from "react";
import {
  ControllerDeviceGrantCadence,
  MachineEnrollmentClaimFailureCode,
  MachineEnrollmentMode,
  type AccountProofDto,
  type BeginMachineEnrollmentClaimableDto,
  type CompleteMachineEnrollmentClaimResponseDto,
} from "@hey-hey/contracts/api";
import type { UserResponseDto } from "@hey-hey/ui-common/api";
import {
  MachineEnrollmentClaimError,
  useAbandonMachineEnrollmentClaim,
  useBeginMachineEnrollmentClaim,
  useCompleteMachineEnrollmentClaim,
} from "@hey-hey/ui-common/data";
import {
  diagnosticFailureFacts,
  PasskeyUnsupportedError,
  recordBrowserSessionDiagnostic,
  requestRegistrationProof,
} from "@hey-hey/ui-common/services";
import { computeLocalApprovalProof } from "../pages/Settings/localApproval";
import { normalizeEnrollmentCode } from "../pages/Settings/machineEnrollmentClaimUtils";
import {
  createMachineEnrollmentCredential,
  type MachineEnrollmentRegistration,
  WebAuthnCancelledError,
  WebAuthnUnsupportedError,
} from "../pages/Settings/machineEnrollmentWebAuthn";
import { adoptSetupSession } from "./setupSession";
import type { SetupOrganization } from "./useSetupOrganization";

export type LocalClaimState =
  | "preparing"
  | "review"
  | "passkey-in-progress"
  | "awaiting-local-confirmation"
  | "expired"
  | "cancelled"
  | "abandon-in-progress"
  | "unsupported-browser"
  | "identity-blocked";

/** The account and organization the setup session is signed in to, both confirmed by the API. */
export interface LocalClaimContext {
  user: UserResponseDto;
  organization: SetupOrganization;
}

export const LOCAL_MACHINE_NAME = "This computer";
export const LOCAL_CONTROLLER_LABEL = "Passkey on this computer";

const CODE_REQUIRED_ERROR = "Enter the 10-character code from your CLI.";
const UNABLE_TO_CLAIM = "Unable to claim this enrollment.";

const supportsNativePasskeys = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof navigator.credentials?.create === "function";

const endsTheClaim = (error: unknown): error is MachineEnrollmentClaimError =>
  error instanceof MachineEnrollmentClaimError &&
  (error.code ===
    MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimExpired ||
    error.code ===
      MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimTerminal);

interface UseLocalPairingClaimOptions {
  /** The one-time code the CLI put in the page address. */
  code: string;
  /** Null when the terminal confirms this pairing instead of the page's proof. */
  approvalSecret: string | null;
  context: LocalClaimContext | null;
  /** The account already has a passkey, so the claim is proven with it. */
  returning: boolean;
  onPasskeyCreated: (enrollmentId: string) => void;
  /** The existing passkey could not be produced in this browser. */
  onPasskeyUnavailable: () => void;
  /** The API refused a proofless passkey because one already exists. */
  onAccountProofRequired: () => void;
}

export interface LocalPairingClaim {
  state: LocalClaimState;
  claim: BeginMachineEnrollmentClaimableDto | null;
  inputError: string | null;
  retryMessage: string | null;
  cadence: ControllerDeviceGrantCadence;
  changeCadence: (cadence: ControllerDeviceGrantCadence) => void;
  createPasskey: () => Promise<void>;
  cancel: () => Promise<void>;
}

/**
 * First-time `heyhey local` pairing. The CLI supplied the code, so the claim
 * is prepared on its own and the person approves with one passkey that both
 * pairs this computer and signs them in. The CLI-opened setup session
 * authorizes that first passkey; an account that already has one proves with
 * it. The passkey's replacement session becomes setup's session.
 */
export function useLocalPairingClaim({
  code,
  approvalSecret,
  context,
  returning,
  onPasskeyCreated,
  onPasskeyUnavailable,
  onAccountProofRequired,
}: UseLocalPairingClaimOptions): LocalPairingClaim {
  const [state, setState] = useState<LocalClaimState>(() =>
    supportsNativePasskeys() ? "preparing" : "unsupported-browser",
  );
  const [claim, setClaim] = useState<BeginMachineEnrollmentClaimableDto | null>(
    null,
  );
  const [completion, setCompletion] =
    useState<CompleteMachineEnrollmentClaimResponseDto | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  // The duration the same passkey grants when the page's proof approves it.
  const [cadence, setCadence] = useState<ControllerDeviceGrantCadence>(
    ControllerDeviceGrantCadence.OneMonth,
  );
  const beginClaim = useBeginMachineEnrollmentClaim();
  const completeClaim = useCompleteMachineEnrollmentClaim();
  const abandonClaim = useAbandonMachineEnrollmentClaim();

  const firstLocalGrant = (
    grantCadence: ControllerDeviceGrantCadence,
  ): { firstLocalGrant?: { cadence: ControllerDeviceGrantCadence } } =>
    approvalSecret !== null
      ? { firstLocalGrant: { cadence: grantCadence } }
      : {};

  const beginRequest = (
    activeContext: LocalClaimContext,
    grantCadence: ControllerDeviceGrantCadence,
  ) => ({
    organizationId: activeContext.organization.id,
    userCode: normalizeEnrollmentCode(code),
    controllerLabel: LOCAL_CONTROLLER_LABEL,
    enrollmentMode: MachineEnrollmentMode.SharedNew,
    ...firstLocalGrant(grantCadence),
  });

  const clearClaim = (): void => {
    setClaim(null);
    setCompletion(null);
    setInputError(null);
    setRetryMessage(null);
  };

  const awaitConfirmation = (
    response: CompleteMachineEnrollmentClaimResponseDto,
  ): void => {
    setCompletion(response);
    setClaim(null);
    setState("awaiting-local-confirmation");
  };

  useEffect(() => {
    if (state === "awaiting-local-confirmation" && completion) {
      onPasskeyCreated(completion.enrollmentId);
    }
  }, [completion, onPasskeyCreated, state]);

  useEffect(() => {
    if (state !== "review" || !claim) {
      return;
    }

    const expiresAt = Date.parse(claim.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      setState("expired");
      return;
    }

    let timer: number | undefined;
    const checkExpiry = (): void => {
      const remainingMs = expiresAt - Date.now();
      if (remainingMs <= 0) {
        setState("expired");
        return;
      }
      timer = window.setTimeout(
        checkExpiry,
        Math.min(remainingMs, 2_147_483_647),
      );
    };

    checkExpiry();
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [claim, state]);

  const handleBegin = async (
    grantCadence: ControllerDeviceGrantCadence,
  ): Promise<void> => {
    if (!context) {
      setState("identity-blocked");
      return;
    }

    if (normalizeEnrollmentCode(code).length !== 10) {
      setInputError(CODE_REQUIRED_ERROR);
      return;
    }

    setInputError(null);
    try {
      const response = await beginClaim.mutate(
        beginRequest(context, grantCadence),
      );
      if (
        response.userId !== context.user.id ||
        response.organizationId !== context.organization.id
      ) {
        clearClaim();
        setState("identity-blocked");
        return;
      }

      if (response.state === "awaiting-machine-confirmation") {
        awaitConfirmation(response);
        return;
      }

      setClaim(response);
      setRetryMessage(null);
      setState("review");
    } catch (error) {
      recordBrowserSessionDiagnostic(
        "passkey_registration_failed",
        diagnosticFailureFacts(error),
      );
      if (endsTheClaim(error)) {
        clearClaim();
        setState("expired");
        return;
      }
      setInputError(
        error instanceof MachineEnrollmentClaimError
          ? error.message
          : UNABLE_TO_CLAIM,
      );
      setState("preparing");
    }
  };

  const beginStarted = useRef(false);
  useEffect(() => {
    if (beginStarted.current || state !== "preparing" || context === null) {
      return;
    }
    beginStarted.current = true;
    void handleBegin(cadence);
  });

  /** The passkey challenge commits to the duration, so a change prepares the claim again. */
  const changeCadence = (nextCadence: ControllerDeviceGrantCadence): void => {
    setCadence(nextCadence);
    setRetryMessage(null);
    setState("preparing");
    void handleBegin(nextCadence);
  };

  const cancel = async (): Promise<void> => {
    if (
      !claim ||
      !context ||
      claim.userId !== context.user.id ||
      claim.organizationId !== context.organization.id
    ) {
      clearClaim();
      setState("cancelled");
      return;
    }

    setState("abandon-in-progress");
    try {
      await abandonClaim.mutate({
        enrollmentId: claim.enrollmentId,
        organizationId: claim.organizationId,
      });
      clearClaim();
      setState("cancelled");
    } catch {
      const expiresAt = Date.parse(claim.expiresAt);
      clearClaim();
      setState(
        Number.isFinite(expiresAt) && expiresAt <= Date.now()
          ? "expired"
          : "cancelled",
      );
    }
  };

  /** Only an account's very first passkey skips account proof; a returning account proves with its passkey. */
  const accountProofForSharedPasskey = (): Promise<
    AccountProofDto | undefined
  > =>
    returning
      ? requestRegistrationProof({ kind: "passkey" })
      : Promise.resolve(undefined);

  const createPasskey = async (): Promise<void> => {
    if (
      !claim ||
      !context ||
      claim.userId !== context.user.id ||
      claim.organizationId !== context.organization.id
    ) {
      setState("identity-blocked");
      return;
    }

    const expiresAt = Date.parse(claim.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      setState("expired");
      return;
    }

    setRetryMessage(null);
    recordBrowserSessionDiagnostic("passkey_registration_started");

    let accountProof: AccountProofDto | undefined;
    if (claim.enrollmentMode === MachineEnrollmentMode.SharedNew) {
      setState("passkey-in-progress");
      try {
        accountProof = await accountProofForSharedPasskey();
      } catch (error) {
        recordBrowserSessionDiagnostic(
          "passkey_registration_failed",
          diagnosticFailureFacts(error),
        );
        if (error instanceof PasskeyUnsupportedError) {
          setRetryMessage(error.message);
        } else {
          // The existing passkey isn't available here; setup offers Repair.
          onPasskeyUnavailable();
        }
        setState("review");
        return;
      }
    }

    setState("passkey-in-progress");
    let registration: MachineEnrollmentRegistration;
    try {
      registration = await createMachineEnrollmentCredential(
        claim.registrationOptions,
      );
    } catch (error) {
      recordBrowserSessionDiagnostic(
        "passkey_registration_failed",
        diagnosticFailureFacts(error),
      );
      if (error instanceof WebAuthnUnsupportedError) {
        setRetryMessage(
          "This browser could not open passkey creation. Try again, or cancel to use a different browser.",
        );
      } else if (error instanceof WebAuthnCancelledError) {
        setRetryMessage(
          "Passkey creation was cancelled. Try again when you are ready.",
        );
      } else {
        setRetryMessage("The browser could not create the passkey. Try again.");
      }
      setState("review");
      return;
    }

    const { credential, publicKeySpki } = registration;
    try {
      // Without the new key the proof cannot bind it; the CLI then asks in the terminal.
      const localApprovalProof =
        approvalSecret === null || publicKeySpki === null
          ? undefined
          : await computeLocalApprovalProof(approvalSecret, {
              enrollmentId: claim.enrollmentId,
              accountId: context.user.id,
              organizationId: context.organization.id,
              controllerCredentialId: credential.rawId,
              credentialPublicKeySpki: publicKeySpki,
              registrationChallenge: claim.registrationOptions.challenge,
            });
      const response = await completeClaim.mutate({
        enrollmentId: claim.enrollmentId,
        organizationId: context.organization.id,
        credential,
        ...(localApprovalProof === undefined ? {} : { localApprovalProof }),
        ...(accountProof === undefined ? {} : { accountProof }),
      });
      recordBrowserSessionDiagnostic("passkey_registration_succeeded", {
        replacementSession: response.session !== undefined,
      });
      if (response.session) {
        // Adding sign-in eligibility ended every earlier session; this is setup's session now.
        adoptSetupSession(response.session);
        recordBrowserSessionDiagnostic("replacement_session_accepted");
      }
      awaitConfirmation(response);
    } catch (error) {
      recordBrowserSessionDiagnostic(
        "passkey_registration_failed",
        diagnosticFailureFacts(error),
      );
      if (endsTheClaim(error)) {
        clearClaim();
        setState("expired");
        return;
      }
      const authoritativeMessage =
        error instanceof MachineEnrollmentClaimError
          ? error.message
          : UNABLE_TO_CLAIM;
      if (error instanceof MachineEnrollmentClaimError && error.code !== null) {
        if (
          error.code ===
          MachineEnrollmentClaimFailureCode.MachineEnrollmentAccountProofRequired
        ) {
          onAccountProofRequired();
        }
        setRetryMessage(authoritativeMessage);
        setState("review");
        return;
      }
      try {
        // The claim may have been consumed before the failure; prepare it again.
        const recovered = await beginClaim.mutate(
          beginRequest(context, cadence),
        );
        if (recovered.state === "awaiting-machine-confirmation") {
          awaitConfirmation(recovered);
          return;
        }
        setClaim(recovered);
      } catch {
        // Keep the current claim so the person can retry without cleanup.
      }
      setRetryMessage(authoritativeMessage);
      setState("review");
    }
  };

  return {
    state,
    claim,
    inputError,
    retryMessage,
    cadence,
    changeCadence,
    createPasskey,
    cancel,
  };
}
