import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useAuth } from "@hey-hey/ui-common/context";
import { hasDemoSandboxSession } from "@hey-hey/ui-common/data";
import {
  PRIVATE_BETA_DISCLOSURE_ROUTE,
  PrivateBetaDisclosureGate,
} from "./PrivateBetaDisclosureGate";
import { getAuthReturnTarget } from "../utils/authReturnTarget";

const DEMO_ROUTE = "/demo";

export interface AppProtectedRouteProps {
  children: ReactNode;
}

export const AppProtectedRoute = ({ children }: AppProtectedRouteProps) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <CircularProgress size={48} />
        <Typography variant="body1" color="text.secondary">
          Loading...
        </Typography>
      </Box>
    );
  }

  if (!isAuthenticated) {
    // A demo visitor whose session ended is told their demo expired rather than
    // being asked to sign in to an account they never had.
    if (hasDemoSandboxSession()) {
      return <Navigate to={DEMO_ROUTE} replace />;
    }
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: getAuthReturnTarget(location) }}
      />
    );
  }

  return (
    <PrivateBetaDisclosureGate
      bypass={location.pathname === PRIVATE_BETA_DISCLOSURE_ROUTE}
    >
      {children}
    </PrivateBetaDisclosureGate>
  );
};
