import { useMemo } from "react";
import { getAuthToken } from "../services/authService";
import { useAuth } from "../contexts/AuthContext";

// JWT token payload interface based on the provided structure
export interface JwtPayload {
  sub: string; // user ID
  email: string;
  name?: string; // Optional name property
  currentOrgId: string;
  orgMemberships: Array<{
    orgId: string;
    role: string;
  }>;
  isDevAdmin: boolean;
  devAdminMode: boolean;
  iat: number;
  exp: number;
}

// User identity interface that the hook returns
export interface UserIdentity {
  userId: string;
  email: string;
  name: string;
  currentOrgId: string;
  orgMemberships: Array<{
    orgId: string;
    role: string;
  }>;
  isDevAdmin: boolean;
  devAdminMode: boolean;
  isTokenExpired: boolean;
  currentOrgRole: string | null; // Role in the current organization
}

// Simple base64url decoder for JWT tokens
const base64UrlDecode = (str: string): string => {
  // Replace URL-safe characters
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");

  // Add padding if necessary
  while (base64.length % 4) {
    base64 += "=";
  }

  try {
    return decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  } catch {
    throw new Error("Invalid base64 string");
  }
};

// Decode JWT token without external library
const decodeJwt = (token: string): JwtPayload => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT token format");
    }

    const payload = base64UrlDecode(parts[1]);
    return JSON.parse(payload) as JwtPayload;
  } catch {
    throw new Error("Failed to decode JWT token");
  }
};

// Check if token is expired
const isTokenExpired = (exp: number): boolean => {
  return Date.now() >= exp * 1000; // exp is in seconds, Date.now() is in milliseconds
};

// Get user's role in the current organization
const getCurrentOrgRole = (
  currentOrgId: string,
  orgMemberships: Array<{ orgId: string; role: string }>
): string | null => {
  const membership = orgMemberships.find((m) => m.orgId === currentOrgId);
  return membership ? membership.role : null;
};

export const useUserIdentity = (): UserIdentity | null => {
  const { loading: authLoading } = useAuth();

  // Get current token
  const token = getAuthToken();

  // Decode token and extract user identity
  const decodedIdentity = useMemo(() => {
    // If auth is still loading, return null
    if (authLoading) {
      return null;
    }

    if (!token) {
      console.log("no token!");
      return null;
    }

    try {
      const payload = decodeJwt(token);
      const currentOrgRole = getCurrentOrgRole(
        payload.currentOrgId,
        payload.orgMemberships
      );

      return {
        userId: payload.sub,
        email: payload.email,
        name: payload.name || payload.email.split("@")[0], // Fallback to email username if name not provided
        currentOrgId: payload.currentOrgId,
        orgMemberships: payload.orgMemberships,
        isDevAdmin: payload.isDevAdmin,
        devAdminMode: payload.devAdminMode,
        isTokenExpired: isTokenExpired(payload.exp),
        currentOrgRole,
      };
    } catch (error) {
      console.error("Failed to decode JWT token:", error);
      return null;
    }
  }, [token, authLoading]);

  return decodedIdentity;
};
