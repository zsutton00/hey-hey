import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Alert, Box, Button, CircularProgress } from "@mui/material";
import type { PrivateBetaDisclosureRequirementDto } from "@hey-hey/ui-common/api";
import {
  useDemoSandbox,
  usePrivateBetaDisclosure,
} from "@hey-hey/ui-common/data";
import { getAuthReturnTarget } from "../utils/authReturnTarget";

export const PRIVATE_BETA_DISCLOSURE_ROUTE = "/private-beta/disclosure";

type DisclosureAcceptance = Pick<
  PrivateBetaDisclosureRequirementDto,
  "documentKind" | "version" | "effectiveDate" | "actionType"
>;

interface DisclosureStatusShape {
  requiredDocuments?: PrivateBetaDisclosureRequirementDto[];
  recordedAcceptances?: DisclosureAcceptance[];
}

const hasCurrentTermsAcceptance = (
  data: DisclosureStatusShape | null | undefined,
): boolean => {
  const termsRequirement = data?.requiredDocuments?.find(
    (requirement) => requirement.documentKind === "TERMS",
  );

  return Boolean(
    termsRequirement &&
    data?.recordedAcceptances?.some(
      (acceptance) =>
        acceptance.documentKind === termsRequirement.documentKind &&
        acceptance.version === termsRequirement.version &&
        acceptance.effectiveDate === termsRequirement.effectiveDate &&
        acceptance.actionType === termsRequirement.actionType,
    ),
  );
};

interface PrivateBetaDisclosureGateProps {
  children: ReactNode;
  bypass?: boolean;
}

const GateLoadingState = () => (
  <Box
    role="status"
    sx={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "100vh",
    }}
  >
    <CircularProgress size={48} aria-label="Loading" />
  </Box>
);

export const PrivateBetaDisclosureGate = ({
  children,
  bypass = false,
}: PrivateBetaDisclosureGateProps) => {
  const location = useLocation();
  const disclosure = usePrivateBetaDisclosure({ enabled: !bypass });
  // Demo visitors are a separate admission class that agrees to its own terms
  // when the sandbox is created, so the beta checkpoint never applies.
  const demo = useDemoSandbox({ enabled: !bypass });

  if (bypass || demo.sandbox) {
    return <>{children}</>;
  }

  if (demo.isLoading) {
    return <GateLoadingState />;
  }

  if (disclosure.isLoading || (!disclosure.isFetched && !disclosure.error)) {
    return <GateLoadingState />;
  }

  if (disclosure.error || !disclosure.isReady || !disclosure.data) {
    return (
      <Box sx={{ maxWidth: 560, mx: "auto", px: 3, py: 10 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          We couldn’t verify the current Terms, so product access is temporarily
          blocked.
        </Alert>
        <Button
          variant="contained"
          onClick={() => {
            void disclosure.refetch();
          }}
        >
          Try again
        </Button>
      </Box>
    );
  }

  if (!hasCurrentTermsAcceptance(disclosure.data)) {
    return (
      <Navigate
        to={PRIVATE_BETA_DISCLOSURE_ROUTE}
        replace
        state={{ from: getAuthReturnTarget(location) }}
      />
    );
  }

  return <>{children}</>;
};
