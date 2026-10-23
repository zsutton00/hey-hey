import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Box, Typography } from "@mui/material";
import {
  HeyHeyBranding,
  OrganizationHomeSelection,
} from "@hey-hey/ui-common/components";
import { useAuth } from "@hey-hey/ui-common/context";

export function OrganizationAccessBoundary({
  children,
  leaveProject,
  showHome,
}: {
  children: ReactNode;
  leaveProject: () => Promise<void>;
  showHome: () => Promise<void>;
}) {
  const {
    user,
    organizationSelection,
    organizationSwitchError,
    switchingOrganization,
    switchOrganization,
    logout,
    loading,
  } = useAuth();
  const confirmedId = user?.currentOrganizationId;
  const previousId = useRef(confirmedId);
  const selectionInterrupted = useRef(false);
  const [readyId, setReadyId] = useState(confirmedId);
  const [error, setError] = useState<string | null>(null);
  if (organizationSelection) selectionInterrupted.current = true;

  useEffect(() => {
    if (!confirmedId || switchingOrganization) return;
    let active = true;
    const changed =
      (previousId.current != null && previousId.current !== confirmedId) ||
      selectionInterrupted.current;
    const settle = async () => {
      if (changed) await leaveProject();
      if (active) {
        previousId.current = confirmedId;
        selectionInterrupted.current = false;
        setReadyId(confirmedId);
      }
    };
    void settle().catch(() =>
      setError("Unable to open the selected organization's projects."),
    );
    return () => {
      active = false;
    };
  }, [confirmedId, switchingOrganization, leaveProject]);

  useEffect(() => {
    if (organizationSelection) {
      void showHome().catch(() => setError("Unable to open Home."));
    }
  }, [organizationSelection, showHome]);

  if (organizationSelection) {
    return (
      <OrganizationHomeSelection
        selection={organizationSelection}
        pending={switchingOrganization}
        error={error}
        onSelect={(organizationId) => {
          setError(null);
          void switchOrganization(organizationId).catch((cause: unknown) =>
            setError(
              cause instanceof Error
                ? cause.message
                : "Organization selection failed",
            ),
          );
        }}
        onSignOut={() => {
          void logout().catch(() => setError("Unable to sign out."));
        }}
      />
    );
  }
  if (
    loading ||
    switchingOrganization ||
    (confirmedId && readyId !== confirmedId)
  ) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 3,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2.5,
            maxWidth: 420,
            textAlign: "center",
          }}
        >
          <Box
            sx={{
              display: "inline-flex",
              alignItems: "center",
              "& > span": { color: "text.primary" },
              animation: error ? "none" : "organizationBrandingPulse 2s ease-in-out infinite",
              "@keyframes organizationBrandingPulse": {
                "0%, 100%": { opacity: 1 },
                "50%": { opacity: 0.45 },
              },
              "@media (prefers-reduced-motion: reduce)": {
                animation: "none",
              },
            }}
          >
            <HeyHeyBranding variant="inline" fontSize="1.5rem" />
          </Box>
          {error ? (
            <Alert severity="error">{error}</Alert>
          ) : (
            <>
              <Box>
                <Typography color="text.secondary">
                  Checking your organization and preparing your workspace.
                </Typography>
              </Box>
            </>
          )}
        </Box>
      </Box>
    );
  }
  return (
    <>
      {organizationSwitchError && (
        <Alert severity="error">{organizationSwitchError}</Alert>
      )}
      {children}
    </>
  );
}
