import React, { createContext, useContext, useEffect, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import type {
  BrowserSessionResponseDto,
  BrowserOrganizationSelectionDto,
} from "../api";
import {
  getAuthToken,
  getBrowserSelection,
  BrowserSessionContinuityDecision,
  getBrowserSessionContinuityDecision,
  login as authLogin,
  logout as authLogout,
  changePassword as authChangePassword,
  changeCurrentPassword as authChangeCurrentPassword,
  initiatePasswordRecovery as authInitiatePasswordRecovery,
  getCurrentUser,
  type LoginCredentials,
  type PasswordChangeRequired,
  refreshAuthToken,
  onAuthChange,
  toggleDevAdminMode as authToggleDevAdminMode,
} from "../services/authService";

interface User {
  id: string;
  email: string;
  name?: string;
  isDevAdmin?: boolean;
  devAdminMode?: boolean;
  currentOrganizationId?: string | null;
}

interface AuthContextType {
  isAuthenticated: boolean;
  organizationSelection: BrowserOrganizationSelectionDto | null;
  switchingOrganization: boolean;
  organizationSwitchError: string | null;
  user: User | null;
  loading: boolean;
  login: (
    credentials: LoginCredentials,
  ) => Promise<BrowserSessionResponseDto | PasswordChangeRequired>;
  completeChangePassword: (
    passwordChangeToken: string,
    newPassword: string,
  ) => Promise<BrowserSessionResponseDto>;
  changeCurrentPassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<BrowserSessionResponseDto>;
  initiatePasswordRecovery: (email: string) => Promise<string>;
  logout: () => Promise<void>;
  toggleDevAdminMode: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [organizationSelection, setOrganizationSelection] =
    useState(getBrowserSelection);
  const [switchingOrganization, setSwitchingOrganization] = useState(false);
  const [organizationSwitchError, setOrganizationSwitchError] = useState<
    string | null
  >(null);

  useEffect(() => {
    return onAuthChange((authenticated) => {
      setIsAuthenticated(authenticated);
      setUser(getCurrentUser());
      setOrganizationSelection(getBrowserSelection());
    });
  }, []);

  useEffect(() => {
    // Check if user is already authenticated on app start
    const token = getAuthToken();
    const currentUser = getCurrentUser();

    if (token && currentUser) {
      setIsAuthenticated(true);
      setUser(currentUser);
      setLoading(false);
    } else if (
      getBrowserSessionContinuityDecision() ===
      BrowserSessionContinuityDecision.RemainSignedOut
    ) {
      setIsAuthenticated(false);
      setUser(null);
      setLoading(false);
    } else {
      // Try cookie-backed renewal when runtime memory has no access token.
      refreshAuthToken()
        .then((tokens) => {
          if (tokens) {
            setIsAuthenticated(true);
            setUser(tokens.user);
            setOrganizationSelection("status" in tokens ? tokens : null);
          }
        })
        .catch(() => {
          // Refresh failed, user needs to log in
          setIsAuthenticated(false);
          setUser(null);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, []);

  const login = async (
    credentials: LoginCredentials,
  ): Promise<BrowserSessionResponseDto | PasswordChangeRequired> => {
    try {
      const result = await authLogin(credentials);
      if ("mustChangePassword" in result) {
        return result;
      }
      setIsAuthenticated(true);
      setUser(result.user || null);
      return result;
    } catch (error) {
      setIsAuthenticated(false);
      setUser(null);
      throw error;
    }
  };

  const completeChangePassword = async (
    passwordChangeToken: string,
    newPassword: string,
  ): Promise<BrowserSessionResponseDto> => {
    try {
      const tokens = await authChangePassword(passwordChangeToken, newPassword);
      setIsAuthenticated(true);
      setUser(tokens.user || null);
      return tokens;
    } catch (error) {
      setIsAuthenticated(false);
      setUser(null);
      throw error;
    }
  };

  const changeCurrentPassword = async (
    currentPassword: string,
    newPassword: string,
  ): Promise<BrowserSessionResponseDto> => {
    const tokens = await authChangeCurrentPassword(
      currentPassword,
      newPassword,
    );
    setIsAuthenticated(true);
    setUser(tokens.user || null);
    return tokens;
  };

  const initiatePasswordRecovery = async (email: string): Promise<string> => {
    const acknowledgement = await authInitiatePasswordRecovery(email);
    return acknowledgement.message;
  };

  const logout = async (): Promise<void> => {
    await authLogout();
    setIsAuthenticated(false);
    setUser(null);
  };

  const toggleDevAdminMode = async (): Promise<void> => {
    try {
      const tokens = await authToggleDevAdminMode();
      setUser(tokens.user || null);
    } catch (error) {
      console.error("Failed to toggle dev-admin mode:", error);
      throw error;
    }
  };

  const switchOrganization = async (organizationId: string): Promise<void> => {
    setSwitchingOrganization(true);
    setOrganizationSwitchError(null);
    try {
      const result = await refreshAuthToken(undefined, organizationId);
      setUser(result.user);
      setOrganizationSelection("status" in result ? result : null);
      setIsAuthenticated(true);
      if (
        "status" in result ||
        result.user.currentOrganizationId !== organizationId
      ) {
        throw new Error(
          "Organization access was denied. Choose an available organization.",
        );
      }
    } catch (error) {
      setOrganizationSwitchError(
        error instanceof Error
          ? error.message
          : "Organization selection failed",
      );
      throw error;
    } finally {
      setSwitchingOrganization(false);
    }
  };

  const value: AuthContextType = {
    isAuthenticated,
    organizationSelection,
    switchingOrganization,
    organizationSwitchError,
    user,
    loading,
    login,
    completeChangePassword,
    changeCurrentPassword,
    initiatePasswordRecovery,
    logout,
    toggleDevAdminMode,
    switchOrganization,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

// Protected route component
export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, loading } = useAuth();
  const token = getAuthToken();

  if (loading && !token) {
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

  if (!isAuthenticated && !token) {
    window.location.href = "/login";
    return null;
  }

  return <>{children}</>;
};
