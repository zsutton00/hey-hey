import {
  CurrentControllerMachineEligibilityState,
  MachineEnrollmentClaimFailureCode,
  type BeginMachineEnrollmentClaimableDto,
  type CompleteMachineEnrollmentClaimResponseDto,
  type MachineEnrollmentWebAuthnRegistrationCredentialDto,
} from "@hey-hey/ui-common/api";
import {
  HeyheyPairTerminalDemo,
  TerminalScene,
} from "@hey-hey/ui-common/components";
import { useOptionalOrganization } from "@hey-hey/ui-common/context";
import {
  useAbandonMachineEnrollmentClaim,
  useBeginMachineEnrollmentClaim,
  useCompleteMachineEnrollmentClaim,
  useUserPairedMachines,
  MachineEnrollmentClaimError,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Step,
  StepLabel,
  Stepper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import {
  createMachineEnrollmentCredential,
  WebAuthnCancelledError,
  WebAuthnUnsupportedError,
} from "./machineEnrollmentWebAuthn";
import { normalizeEnrollmentCode } from "./machineEnrollmentClaimUtils";

type ClaimViewState =
  | "run-cli"
  | "code-entry"
  | "review"
  | "passkey-in-progress"
  | "awaiting-local-confirmation"
  | "complete"
  | "expired"
  | "cancelled"
  | "abandon-in-progress"
  | "unsupported-browser"
  | "identity-blocked";

type PairingStepId =
  "run-cli" | "enter-code" | "create-passkey" | "confirm-in-cli" | "complete";

export type PairingJourney = "first-machine" | "existing-machine";

interface ClaimMachineProps {
  initialCode: string | null;
  completionActionLabel?: string;
  onCompletionAction?: () => void;
  journey?: PairingJourney;
  authorizationTarget?: {
    machineId: string;
    machineName: string;
  };
}

const PAIRING_STEPS: ReadonlyArray<{ id: PairingStepId; label: string }> = [
  { id: "run-cli", label: "Run the Agent Bridge command" },
  { id: "enter-code", label: "Enter the pairing code" },
  { id: "create-passkey", label: "Create a passkey" },
  { id: "confirm-in-cli", label: "Confirm in the Agent Bridge" },
  { id: "complete", label: "Complete" },
];

const CONTROLLER_AUTHORIZATION_PROMPT =
  "Authorize this controller on this machine? [y/N]";
const CODE_REQUIRED_ERROR = "Enter the 10-character code from your CLI.";
const MACHINE_NAME_REQUIRED_ERROR = "Enter a name for this Agent Bridge.";
const CONTROLLER_LABEL_REQUIRED_ERROR =
  "Enter a label for this browser passkey.";

const stepForState = (state: ClaimViewState): PairingStepId => {
  if (state === "run-cli") {
    return "run-cli";
  }
  if (
    state === "review" ||
    state === "passkey-in-progress" ||
    state === "abandon-in-progress" ||
    state === "expired" ||
    state === "cancelled" ||
    state === "unsupported-browser"
  ) {
    return "create-passkey";
  }
  if (state === "awaiting-local-confirmation") {
    return "confirm-in-cli";
  }
  if (state === "complete") {
    return "complete";
  }
  return "enter-code";
};

const supportsNativePasskeys = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof navigator.credentials?.create === "function";

const initializeClaimJourney = (
  initialCode: string | null,
): { state: ClaimViewState; code: string } => {
  if (!supportsNativePasskeys()) {
    return { state: "unsupported-browser", code: initialCode ?? "" };
  }
  if (initialCode === null) {
    return { state: "run-cli", code: "" };
  }
  return {
    state: "code-entry",
    code: initialCode,
  };
};

const osLabel = (
  osFamily: BeginMachineEnrollmentClaimableDto["osFamily"],
): string => {
  if (osFamily === "macos") {
    return "macOS";
  }
  return osFamily[0].toUpperCase() + osFamily.slice(1);
};

const renderDetail = (label: string, value: string) => (
  <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between" }}>
    <Typography color="text.secondary" variant="body2">
      {label}
    </Typography>
    <Typography
      data-testid={`settings-machine-claim-${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`}
      variant="body2"
      sx={{ textAlign: "right", wordBreak: "break-word" }}
    >
      {value}
    </Typography>
  </Stack>
);

export const ClaimMachine: React.FC<ClaimMachineProps> = ({
  initialCode,
  completionActionLabel = "Continue",
  onCompletionAction,
  journey = "first-machine",
  authorizationTarget,
}) => {
  const identity = useUserIdentity();
  const organizationContext = useOptionalOrganization();
  const organization = organizationContext?.currentOrganization;
  const existingMachineJourney =
    journey === "existing-machine" || authorizationTarget !== undefined;

  const [initialJourney] = useState(() => initializeClaimJourney(initialCode));
  const [state, setState] = useState<ClaimViewState>(initialJourney.state);
  const [code, setCode] = useState(initialJourney.code);
  const [machineName, setMachineName] = useState("");
  const [controllerLabel, setControllerLabel] = useState("");
  const [claim, setClaim] = useState<BeginMachineEnrollmentClaimableDto | null>(
    null,
  );
  const [completion, setCompletion] =
    useState<CompleteMachineEnrollmentClaimResponseDto | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [claimFailureMessage, setClaimFailureMessage] = useState<string | null>(
    null,
  );
  const [passkeyRetryMessage, setPasskeyRetryMessage] = useState<string | null>(
    null,
  );
  const abandonClaim = useAbandonMachineEnrollmentClaim();
  const beginClaim = useBeginMachineEnrollmentClaim();
  const completeClaim = useCompleteMachineEnrollmentClaim();
  const { machines: pairedMachines, refetch: refetchPairedMachines } =
    useUserPairedMachines();
  const attemptRevision = useRef(0);
  const previousInitialCode = useRef(initialCode);

  useEffect(() => {
    if (initialCode === previousInitialCode.current) return;
    previousInitialCode.current = initialCode;
    if (initialCode === null) return;
    attemptRevision.current += 1;
    setCode(initialCode);
    setMachineName("");
    setControllerLabel("");
    setClaim(null);
    setCompletion(null);
    setInputError(null);
    setClaimFailureMessage(null);
    setPasskeyRetryMessage(null);
    setState(supportsNativePasskeys() ? "code-entry" : "unsupported-browser");
  }, [authorizationTarget?.machineName, existingMachineJourney, initialCode]);

  const validatedClaimContext =
    identity &&
    !identity.isTokenExpired &&
    organizationContext?.loading === false &&
    organization &&
    organization.id.trim().length > 0 &&
    organization.name.trim().length > 0 &&
    identity.orgMemberships.some(
      (membership) => membership.orgId === organization.id,
    )
      ? { identity, organization }
      : null;
  const claimMatchesIdentity =
    claim !== null &&
    validatedClaimContext !== null &&
    claim.userId === validatedClaimContext.identity.userId &&
    claim.organizationId === validatedClaimContext.organization.id;
  const canAbandonActiveClaim =
    claim !== null &&
    identity !== null &&
    !identity.isTokenExpired &&
    claim.userId === identity.userId &&
    identity.orgMemberships.some(
      (membership) => membership.orgId === claim.organizationId,
    );
  const identityGateBlocked =
    state === "identity-blocked" ||
    validatedClaimContext === null ||
    (claim !== null && !claimMatchesIdentity);

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

  useEffect(() => {
    if (state !== "awaiting-local-confirmation" || !completion) {
      return;
    }

    if (
      pairedMachines.some(
        (machine) =>
          machine.machineId === completion.machineId &&
          machine.currentControllerEligibility ===
            CurrentControllerMachineEligibilityState.Eligible,
      )
    ) {
      setState("complete");
      return;
    }

    const timer = window.setInterval(() => {
      void refetchPairedMachines();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [completion, pairedMachines, refetchPairedMachines, state]);

  const clearClaim = (): void => {
    setCode("");
    setMachineName("");
    setControllerLabel("");
    setClaim(null);
    setCompletion(null);
    setInputError(null);
    setPasskeyRetryMessage(null);
  };

  const startFreshEnrollment = (): void => {
    attemptRevision.current += 1;
    clearClaim();
    setClaimFailureMessage(null);
    setState(supportsNativePasskeys() ? "run-cli" : "unsupported-browser");
  };

  const activeStepId = stepForState(state);
  const activeStepIndex = PAIRING_STEPS.findIndex(
    ({ id }) => id === activeStepId,
  );
  const codeInputError =
    inputError !== MACHINE_NAME_REQUIRED_ERROR &&
    inputError !== CONTROLLER_LABEL_REQUIRED_ERROR
      ? inputError
      : null;

  const applyAuthoritativeClaimFailure = (error: unknown): boolean => {
    if (!(error instanceof MachineEnrollmentClaimError)) {
      setInputError("Unable to claim this enrollment.");
      return false;
    }

    setClaimFailureMessage(error.message);
    if (
      error.code ===
        MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimExpired ||
      error.code ===
        MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimTerminal
    ) {
      clearClaim();
      setState("expired");
      return true;
    }

    setInputError(error.message);
    return false;
  };

  const handleBegin = async (): Promise<void> => {
    if (!validatedClaimContext) {
      setState("identity-blocked");
      return;
    }

    const normalizedCode = normalizeEnrollmentCode(code);
    const normalizedMachineName = machineName.trim();
    const normalizedLabel = controllerLabel.trim();

    if (normalizedCode.length !== 10) {
      setInputError(CODE_REQUIRED_ERROR);
      return;
    }
    if (!existingMachineJourney && !normalizedMachineName) {
      setInputError(MACHINE_NAME_REQUIRED_ERROR);
      return;
    }
    if (!normalizedLabel) {
      setInputError(CONTROLLER_LABEL_REQUIRED_ERROR);
      return;
    }
    const activeAttemptRevision = attemptRevision.current;
    setInputError(null);
    setClaimFailureMessage(null);
    try {
      const beginRequest = {
        organizationId: validatedClaimContext.organization.id,
        userCode: normalizedCode,
        controllerLabel: normalizedLabel,
      };
      const response = await beginClaim.mutate(beginRequest);
      if (activeAttemptRevision !== attemptRevision.current) return;

      if (
        authorizationTarget &&
        response.machineId !== authorizationTarget.machineId
      ) {
        await abandonClaim.mutate({
          enrollmentId: response.enrollmentId,
          organizationId: validatedClaimContext.organization.id,
        });
        setInputError(
          `That code belongs to another Agent Bridge, not ${authorizationTarget.machineName}. Run heyhey controllers add on ${authorizationTarget.machineName} and enter the code it displays.`,
        );
        setState("code-entry");
        return;
      }

      if (
        response.userId !== validatedClaimContext.identity.userId ||
        response.organizationId !== validatedClaimContext.organization.id
      ) {
        clearClaim();
        setState("identity-blocked");
        return;
      }

      if (response.state === "awaiting-machine-confirmation") {
        setCompletion(response);
        setClaim(null);
        setCode("");
        setState("awaiting-local-confirmation");
        return;
      }

      setClaim(response);
      setPasskeyRetryMessage(null);
      setState("review");
    } catch (error) {
      if (activeAttemptRevision !== attemptRevision.current) return;
      if (!applyAuthoritativeClaimFailure(error)) {
        setState("code-entry");
      }
    }
  };

  const cancelClaim = async (): Promise<void> => {
    if (!claim) {
      setState("cancelled");
      return;
    }

    if (!canAbandonActiveClaim) {
      clearClaim();
      setState("cancelled");
      return;
    }

    const activeAttemptRevision = attemptRevision.current;
    setState("abandon-in-progress");
    try {
      await abandonClaim.mutate({
        enrollmentId: claim.enrollmentId,
        organizationId: claim.organizationId,
      });
      if (activeAttemptRevision !== attemptRevision.current) return;
      clearClaim();
      setState("cancelled");
    } catch {
      if (activeAttemptRevision !== attemptRevision.current) return;
      const expiresAt = Date.parse(claim.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        clearClaim();
        setState("expired");
        return;
      }
      clearClaim();
      setState("cancelled");
    }
  };

  const handleCreatePasskey = async (): Promise<void> => {
    if (
      !claim ||
      !validatedClaimContext ||
      claim.userId !== validatedClaimContext.identity.userId ||
      claim.organizationId !== validatedClaimContext.organization.id
    ) {
      setState("identity-blocked");
      return;
    }

    const expiresAt = Date.parse(claim.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      setState("expired");
      return;
    }

    const activeAttemptRevision = attemptRevision.current;
    setPasskeyRetryMessage(null);
    setState("passkey-in-progress");
    let credential: MachineEnrollmentWebAuthnRegistrationCredentialDto;
    try {
      credential = await createMachineEnrollmentCredential(
        claim.registrationOptions,
      );
      if (activeAttemptRevision !== attemptRevision.current) return;
    } catch (error) {
      if (activeAttemptRevision !== attemptRevision.current) return;
      if (error instanceof WebAuthnUnsupportedError) {
        setPasskeyRetryMessage(
          "This browser could not open passkey creation. Try again, or cancel to use a different browser.",
        );
      } else if (error instanceof WebAuthnCancelledError) {
        setPasskeyRetryMessage(
          "Passkey creation was cancelled. Try again when you are ready.",
        );
      } else {
        setPasskeyRetryMessage(
          "The browser could not create the passkey. Try again.",
        );
      }
      setState("review");
      return;
    }

    try {
      const response = await completeClaim.mutate({
        enrollmentId: claim.enrollmentId,
        organizationId: validatedClaimContext.organization.id,
        credential,
      });
      if (activeAttemptRevision !== attemptRevision.current) return;
      setCompletion(response);
      setClaim(null);
      setCode("");
      setState("awaiting-local-confirmation");
    } catch (error) {
      if (activeAttemptRevision !== attemptRevision.current) return;
      if (
        error instanceof MachineEnrollmentClaimError &&
        (error.code ===
          MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimExpired ||
          error.code ===
            MachineEnrollmentClaimFailureCode.MachineEnrollmentClaimTerminal)
      ) {
        setClaimFailureMessage(error.message);
        clearClaim();
        setState("expired");
        return;
      }
      const authoritativeMessage =
        error instanceof MachineEnrollmentClaimError
          ? error.message
          : "Unable to claim this enrollment.";
      if (error instanceof MachineEnrollmentClaimError && error.code !== null) {
        setPasskeyRetryMessage(authoritativeMessage);
        setState("review");
        return;
      }
      try {
        const recoveryRequest = {
          organizationId: validatedClaimContext.organization.id,
          userCode: normalizeEnrollmentCode(code),
          controllerLabel: claim.controllerLabel,
        };
        const recovered = await beginClaim.mutate(recoveryRequest);
        if (activeAttemptRevision !== attemptRevision.current) return;
        if (
          authorizationTarget &&
          recovered.machineId !== authorizationTarget.machineId
        ) {
          await abandonClaim.mutate({
            enrollmentId: recovered.enrollmentId,
            organizationId: validatedClaimContext.organization.id,
          });
          setInputError(
            `That code does not belong to ${authorizationTarget.machineName}. Run heyhey controllers add there and enter the code it displays.`,
          );
          setState("code-entry");
          return;
        }
        if (recovered.state === "awaiting-machine-confirmation") {
          setCompletion(recovered);
          setClaim(null);
          setCode("");
          setState("awaiting-local-confirmation");
          return;
        }
        setClaim(recovered);
      } catch {
        if (activeAttemptRevision !== attemptRevision.current) return;
        // Keep the attempt-local claim so the user can retry without cleanup.
      }
      setPasskeyRetryMessage(authoritativeMessage);
      setState("review");
    }
  };

  return (
    <Box data-testid="settings-machine-claim" sx={{ mb: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        {authorizationTarget
          ? `Authorize this browser for ${authorizationTarget.machineName}`
          : existingMachineJourney
            ? "Add a controller"
            : "Add an Agent Bridge"}
      </Typography>

      <Stepper activeStep={activeStepIndex} alternativeLabel sx={{ mb: 3 }}>
        {PAIRING_STEPS.map(({ id, label }, index) => (
          <Step key={id} completed={index < activeStepIndex}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {identityGateBlocked ? (
        <Alert
          severity="warning"
          data-testid="settings-machine-claim-identity-blocked"
        >
          {claim ? (
            <>
              The previous browser claim is still open. Restore the
              authenticated account and organization used to begin it before
              closing that claim or starting a fresh enrollment.
            </>
          ) : (
            <>
              We cannot safely{" "}
              {existingMachineJourney
                ? "add a controller"
                : "start Agent Bridge pairing"}{" "}
              until your authenticated account and selected organization are
              fully loaded and your membership is verified. For your security,
              browser passkey creation is blocked.
              <Box sx={{ mt: 1 }}>
                <Button variant="outlined" onClick={startFreshEnrollment}>
                  Start a fresh enrollment
                </Button>
              </Box>
            </>
          )}
        </Alert>
      ) : null}

      {!identityGateBlocked && state === "unsupported-browser" ? (
        <Alert
          severity="warning"
          data-testid="settings-machine-claim-unsupported"
        >
          This browser cannot create a native passkey. Open this pairing link in
          a browser with passkey support. Your current CLI enrollment remains
          valid.
        </Alert>
      ) : null}

      {!identityGateBlocked && state === "abandon-in-progress" ? (
        <Alert severity="info" data-testid="settings-machine-claim-abandoning">
          Cancelling pairing.
          <CircularProgress size={16} sx={{ ml: 1 }} />
        </Alert>
      ) : null}

      {!identityGateBlocked && state === "expired" ? (
        <Alert severity="info" data-testid="settings-machine-claim-expired">
          {claimFailureMessage ??
            "This enrollment has expired. Start a fresh CLI enrollment to get a new code."}
          <Box sx={{ mt: 1 }}>
            <Button variant="outlined" onClick={startFreshEnrollment}>
              Try a new code
            </Button>
          </Box>
        </Alert>
      ) : null}

      {!identityGateBlocked && state === "cancelled" ? (
        <Alert severity="info" data-testid="settings-machine-claim-cancelled">
          Pairing was cancelled.
          <Box sx={{ mt: 1 }}>
            <Button onClick={startFreshEnrollment}>Start over</Button>
          </Box>
        </Alert>
      ) : null}

      {!identityGateBlocked &&
      state === "awaiting-local-confirmation" &&
      completion ? (
        <Alert severity="success" data-testid="settings-machine-claim-success">
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Passkey created; local confirmation is still required
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {renderDetail("Passkey name", completion.controllerLabel)}
            {renderDetail(
              "Credential fingerprint",
              completion.credentialFingerprint,
            )}
            {renderDetail(
              "Backup eligibility",
              completion.backupEligible ? "Eligible" : "Not eligible",
            )}
            {renderDetail(
              "Backup state",
              completion.backupState ? "Backed up" : "Not backed up",
            )}
            {renderDetail("Status", "Awaiting local confirmation")}
          </Stack>
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            Synced passkeys can be available across your approved device
            ecosystem. The backup evidence above is verified by the server. This
            Agent Bridge is not active until the CLI confirms locally.
          </Typography>
          <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 600 }}>
            {authorizationTarget
              ? `Return to the ${authorizationTarget.machineName} terminal where you ran heyhey controllers add and confirm the controller there.`
              : existingMachineJourney
                ? "Return to the terminal where you ran heyhey controllers add and confirm the controller there."
                : "Return to the terminal where you ran heyhey pair and confirm the Agent Bridge there."}
          </Typography>
          <Box sx={{ mt: 1.5 }}>
            <TerminalScene
              command={CONTROLLER_AUTHORIZATION_PROMPT}
              testIdPrefix="controller-authorization-terminal"
            />
          </Box>
        </Alert>
      ) : null}

      {!identityGateBlocked && state === "complete" && completion ? (
        <Alert severity="success" data-testid="settings-machine-claim-complete">
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {authorizationTarget
              ? "Browser authorized"
              : existingMachineJourney
                ? "Controller added"
                : "Agent Bridge paired"}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {authorizationTarget
              ? `Local confirmation succeeded. This browser is now authorized for ${authorizationTarget.machineName}.`
              : existingMachineJourney
                ? "Local confirmation succeeded. This controller is now authorized for the Agent Bridge."
                : "Local confirmation succeeded and this Agent Bridge is ready to use."}
          </Typography>
          <Box sx={{ mt: 1.5 }}>
            <Button
              variant="contained"
              onClick={onCompletionAction}
              data-testid="settings-machine-claim-completion-action"
            >
              {completionActionLabel}
            </Button>
          </Box>
        </Alert>
      ) : null}

      {!identityGateBlocked && state === "run-cli" ? (
        <Stack spacing={2} data-testid="settings-machine-claim-run-cli">
          <Typography variant="body2" color="text.secondary">
            {authorizationTarget
              ? `On ${authorizationTarget.machineName}, add this browser as a controller. Keep the terminal open so you can confirm it after creating the Passkey.`
              : existingMachineJourney
                ? "On the machine where you want to add this controller, run heyhey controllers add. Keep the terminal open so you can confirm it after creating the Passkey."
                : "On the computer you want to connect, run the pairing command in the Hey Hey CLI. That CLI becomes the Agent Bridge. Keep the terminal open so you can confirm it after creating the Passkey."}
          </Typography>
          {authorizationTarget ? (
            <TerminalScene
              command="heyhey controllers add"
              testIdPrefix="authorize-browser-terminal"
            />
          ) : existingMachineJourney ? (
            <TerminalScene
              command="heyhey controllers add"
              testIdPrefix="add-controller-terminal"
            />
          ) : (
            <HeyheyPairTerminalDemo />
          )}
          <Button
            variant="contained"
            onClick={() => setState("code-entry")}
            data-testid="settings-machine-claim-cli-done"
          >
            Done
          </Button>
        </Stack>
      ) : null}

      {!identityGateBlocked && state === "code-entry" ? (
        <Stack spacing={2} data-testid="settings-machine-claim-code-entry">
          <Typography variant="body2" color="text.secondary">
            {authorizationTarget
              ? `Run heyhey controllers add on ${authorizationTarget.machineName}. Enter its one-time code, then review the controller before creating a Passkey.`
              : existingMachineJourney
                ? "Enter the one-time code shown by heyhey controllers add, then review the existing Agent Bridge before creating a Passkey."
                : "Run a fresh pairing command in the Agent Bridge CLI. Enter the one-time code it displays, then review the Agent Bridge before creating a Passkey."}
          </Typography>
          <Stack spacing={0.75}>
            {renderDetail(
              "Account",
              `${validatedClaimContext.identity.name} (${validatedClaimContext.identity.email})`,
            )}
            {renderDetail(
              "Organization",
              `${validatedClaimContext.organization.name} (${validatedClaimContext.organization.id})`,
            )}
          </Stack>
          <TextField
            label="Agent Bridge pairing code"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setInputError(null);
            }}
            error={codeInputError !== null}
            helperText={
              codeInputError ?? "Use the code shown by the Agent Bridge CLI."
            }
            inputProps={{ "data-testid": "settings-machine-claim-code" }}
            autoComplete="off"
            inputMode="text"
          />
          {!existingMachineJourney ? (
            <TextField
              label="Agent Bridge name"
              placeholder="My laptop"
              required
              value={machineName}
              onChange={(event) => {
                setMachineName(event.target.value);
                setInputError(null);
              }}
              error={inputError === MACHINE_NAME_REQUIRED_ERROR}
              helperText={
                inputError === MACHINE_NAME_REQUIRED_ERROR
                  ? inputError
                  : "Use a name you will recognize later."
              }
              inputProps={{
                "data-testid": "settings-machine-claim-machine-name",
              }}
            />
          ) : null}
          <TextField
            label="Passkey name"
            placeholder="Chrome on my laptop"
            required
            value={controllerLabel}
            onChange={(event) => {
              setControllerLabel(event.target.value);
              setInputError(null);
            }}
            error={inputError === CONTROLLER_LABEL_REQUIRED_ERROR}
            helperText={
              inputError === CONTROLLER_LABEL_REQUIRED_ERROR
                ? inputError
                : "This label will identify the browser passkey."
            }
            inputProps={{
              "data-testid": "settings-machine-claim-controller-label",
            }}
          />
          <Button
            variant="contained"
            onClick={() => void handleBegin()}
            disabled={beginClaim.isPending}
            data-testid="settings-machine-claim-begin"
          >
            {beginClaim.isPending ? (
              <CircularProgress size={20} color="inherit" />
            ) : existingMachineJourney ? (
              "Review controller"
            ) : (
              "Review Agent Bridge"
            )}
          </Button>
        </Stack>
      ) : null}

      {!identityGateBlocked && state === "review" && claim ? (
        <Stack spacing={2} data-testid="settings-machine-claim-review">
          {passkeyRetryMessage ? (
            <Alert
              severity="info"
              data-testid="settings-machine-claim-passkey-retry"
            >
              {passkeyRetryMessage}
            </Alert>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            Review these non-secret Agent Bridge details before your browser
            asks for a Passkey.
          </Typography>
          <Stack spacing={0.75}>
            {renderDetail("Agent Bridge name", claim.machineName)}
            {renderDetail("Operating system", osLabel(claim.osFamily))}
            {renderDetail("CLI version", claim.cliVersion)}
            {renderDetail("Key fingerprint", claim.machineKeyFingerprint)}
            {renderDetail(
              "Account",
              `${validatedClaimContext.identity.name} (${validatedClaimContext.identity.email})`,
            )}
            {renderDetail(
              "Organization",
              `${validatedClaimContext.organization.name} (${validatedClaimContext.organization.id})`,
            )}
            {renderDetail("Passkey name", claim.controllerLabel)}
          </Stack>
          <Divider />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              onClick={() => void handleCreatePasskey()}
              data-testid="settings-machine-claim-create-passkey"
            >
              {passkeyRetryMessage
                ? "Try creating passkey again"
                : "Create native passkey"}
            </Button>
            <Button
              onClick={() => void cancelClaim()}
              data-testid="settings-machine-claim-cancel"
            >
              Cancel
            </Button>
          </Stack>
        </Stack>
      ) : null}

      {!identityGateBlocked && state === "passkey-in-progress" ? (
        <Stack
          spacing={2}
          data-testid="settings-machine-claim-passkey-in-progress"
        >
          <CircularProgress size={28} />
          <Typography>
            Complete the Passkey prompt in your browser. The Agent Bridge will
            remain inactive until its CLI confirms locally.
          </Typography>
        </Stack>
      ) : null}
    </Box>
  );
};
