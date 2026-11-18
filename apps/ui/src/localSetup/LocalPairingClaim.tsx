import { Alert, Box, CircularProgress } from "@mui/material";
import { useTranslation } from "react-i18next";
import type {
  BeginMachineEnrollmentClaimableDto,
  LocalCodingAgentDetectionDto,
  UserResponseDto,
} from "@hey-hey/ui-common/api";
import { formatUserIdentity } from "@hey-hey/ui-common/hooks";
import { LocalPairingScreen } from "../pages/LocalSetup/LocalPairingScreen";
import {
  LOCAL_CONTROLLER_LABEL,
  LOCAL_MACHINE_NAME,
  useLocalPairingClaim,
  type LocalClaimContext,
} from "./useLocalPairingClaim";
import { setupSessionExpired } from "./setupSession";
import { useSetupOrganization } from "./useSetupOrganization";

interface LocalPairingClaimProps {
  code: string;
  approvalSecret: string | null;
  agents: LocalCodingAgentDetectionDto | null;
  /** The account the setup session is signed in to. */
  user: UserResponseDto;
  returning: boolean;
  onPasskeyCreated: (enrollmentId: string) => void;
  onPasskeyUnavailable: () => void;
  onAccountProofRequired: () => void;
  /** The Repair explanation and action, when offered. */
  repair: React.ReactNode;
}

const osLabel = (
  osFamily: BeginMachineEnrollmentClaimableDto["osFamily"],
): string =>
  osFamily === "macos"
    ? "macOS"
    : osFamily[0].toUpperCase() + osFamily.slice(1);

/** The pairing step of local setup: one passkey approves this computer for the signed-in account. */
export function LocalPairingClaim({
  code,
  approvalSecret,
  agents,
  user,
  returning,
  onPasskeyCreated,
  onPasskeyUnavailable,
  onAccountProofRequired,
  repair,
}: LocalPairingClaimProps): React.JSX.Element {
  const { t } = useTranslation();
  const organizationState = useSetupOrganization(
    user.currentOrganizationId ?? null,
  );
  const context: LocalClaimContext | null =
    organizationState.kind === "loaded" &&
    organizationState.organization &&
    !setupSessionExpired()
      ? { user, organization: organizationState.organization }
      : null;
  const pairing = useLocalPairingClaim({
    code,
    approvalSecret,
    context,
    returning,
    onPasskeyCreated,
    onPasskeyUnavailable,
    onAccountProofRequired,
  });
  const { state, claim } = pairing;

  if (organizationState.kind === "loading") {
    return (
      <Box data-testid="local-pairing-loading" aria-live="polite">
        <CircularProgress size={24} />
      </Box>
    );
  }

  const identityBlocked =
    state === "identity-blocked" ||
    context === null ||
    (claim !== null &&
      (claim.userId !== context.user.id ||
        claim.organizationId !== context.organization.id));

  if (identityBlocked) {
    return (
      <Alert
        severity="warning"
        data-testid="settings-machine-claim-identity-blocked"
      >
        We cannot safely start Agent Bridge pairing until your authenticated
        account and selected organization are fully loaded and your membership
        is verified. For your security, browser passkey creation is blocked. Run
        heyhey local again to start a new pairing.
      </Alert>
    );
  }

  if (state === "unsupported-browser") {
    return (
      <Alert
        severity="warning"
        data-testid="settings-machine-claim-unsupported"
      >
        This browser cannot create a native passkey. Open this pairing link in a
        browser with passkey support. Your current CLI enrollment remains valid.
      </Alert>
    );
  }

  if (state === "abandon-in-progress") {
    return (
      <Alert severity="info" data-testid="settings-machine-claim-abandoning">
        Cancelling pairing.
        <CircularProgress size={16} sx={{ ml: 1 }} />
      </Alert>
    );
  }

  if (state === "expired") {
    return (
      <Alert severity="info" data-testid="settings-machine-claim-expired">
        This pairing expired. Run heyhey local again to start a new one.
      </Alert>
    );
  }

  if (state === "cancelled") {
    return (
      <Alert severity="info" data-testid="settings-machine-claim-cancelled">
        Pairing was cancelled. Run heyhey local again to start over.
      </Alert>
    );
  }

  if (pairing.inputError) {
    return (
      <Alert
        severity="warning"
        data-testid="settings-machine-claim-local-failed"
      >
        {pairing.inputError} Run heyhey local again to start a new pairing.
      </Alert>
    );
  }

  if (state === "awaiting-local-confirmation") {
    // Setup moves on to its progress screen as soon as the passkey exists.
    return <CircularProgress size={24} />;
  }

  const technicalDetails = [
    ...(claim
      ? [
          {
            label: t("localSetup.pairing.technical.os"),
            value: osLabel(claim.osFamily),
          },
          {
            label: t("localSetup.pairing.technical.cliVersion"),
            value: claim.cliVersion,
          },
          {
            label: t("localSetup.pairing.technical.fingerprint"),
            value: claim.machineKeyFingerprint,
          },
        ]
      : []),
    {
      label: t("localSetup.pairing.technical.account"),
      value: formatUserIdentity(context.user),
    },
    {
      label: t("localSetup.pairing.technical.organization"),
      value: `${context.organization.name} (${context.organization.id})`,
    },
    {
      label: t("localSetup.pairing.technical.passkeyName"),
      value: claim?.controllerLabel ?? LOCAL_CONTROLLER_LABEL,
    },
  ];

  return (
    <LocalPairingScreen
      computerName={claim?.machineName ?? LOCAL_MACHINE_NAME}
      agents={agents}
      technicalDetails={technicalDetails}
      ready={claim !== null && state !== "preparing"}
      busy={state === "passkey-in-progress"}
      retryMessage={pairing.retryMessage}
      returning={returning}
      grantsAccess={approvalSecret !== null}
      repair={repair}
      cadence={pairing.cadence}
      onCadenceChange={pairing.changeCadence}
      onCreatePasskey={() => void pairing.createPasskey()}
      onCancel={() => void pairing.cancel()}
    />
  );
}
