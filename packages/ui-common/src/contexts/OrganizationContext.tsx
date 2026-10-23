import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import { apiClient } from "../clients";
import { useAuth } from "./AuthContext";
import type { OrganizationResponseDto as Organization } from "../api";

interface OrganizationContextType {
  organizations: Organization[];
  currentOrganization: Organization | null;
  loading: boolean;
  error: string | null;
  switchOrganization: (orgId: string) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  createOrganization: (data: {
    name: string;
    description?: string;
  }) => Promise<Organization>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(
  undefined
);

export const useOrganization = () => {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error(
      "useOrganization must be used within an OrganizationProvider"
    );
  }
  return context;
};

export const useOptionalOrganization = ():
  | OrganizationContextType
  | undefined => useContext(OrganizationContext);

interface OrganizationProviderProps {
  children: React.ReactNode;
}

export const OrganizationProvider: React.FC<OrganizationProviderProps> = ({
  children,
}) => {
  const {
    isAuthenticated,
    organizationSelection,
    switchingOrganization,
    user,
    switchOrganization: switchAuthOrganization,
  } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrganization, setCurrentOrganization] =
    useState<Organization | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestVersion = useRef(0);
  const confirmedId = user?.currentOrganizationId;
  const identity = useRef({ userId: user?.id, confirmedId });
  identity.current = { userId: user?.id, confirmedId };

  // Load organizations when user is authenticated
  const refreshOrganizations = async () => {
    if (!isAuthenticated || !confirmedId || organizationSelection) return;
    const version = ++requestVersion.current;
    const requestedIdentity = identity.current;

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.getMyOrganizations();
      if (
        version !== requestVersion.current ||
        requestedIdentity.userId !== identity.current.userId ||
        requestedIdentity.confirmedId !== identity.current.confirmedId
      )
        return;
      const orgs = response.data.data;
      if (!orgs) throw new Error("Missing organization response");
      setOrganizations(orgs);

      const authoritativeOrganization = orgs.find(
        (org) => org.id === user?.currentOrganizationId
      );
      if (authoritativeOrganization) {
        setCurrentOrganization(authoritativeOrganization);
        localStorage.setItem(
          "currentOrganizationId",
          authoritativeOrganization.id
        );
      } else {
        setCurrentOrganization(null);
      }
    } catch (err) {
      if (
        version !== requestVersion.current ||
        requestedIdentity.userId !== identity.current.userId ||
        requestedIdentity.confirmedId !== identity.current.confirmedId
      )
        return;
      console.error("Failed to fetch organizations:", err);
      setError("Failed to load organizations");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  // Switch to a different organization
  const switchOrganization = async (orgId: string): Promise<void> => {
    const org = organizations.find((o) => o.id === orgId);
    if (!org) throw new Error("Organization is not available");
    setError(null);
    try {
      await switchAuthOrganization(orgId);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Organization selection failed"
      );
      throw error;
    }
  };

  // Create a new organization
  const createOrganization = async (data: {
    name: string;
    description?: string;
  }): Promise<Organization> => {
    try {
      const response = await apiClient.createOrganization({
        createOrganizationDto: data,
      });
      const newOrg = response.data?.data;
      if (newOrg) {
        setOrganizations((prev) => [...prev, newOrg]);
        await switchAuthOrganization(newOrg.id);
        return newOrg;
      }
      throw new Error("Failed to create organization");
    } catch (err) {
      console.error("Failed to create organization:", err);
      throw new Error("Failed to create organization");
    }
  };

  // Load organizations on auth change
  useEffect(() => {
    if (isAuthenticated && confirmedId && !organizationSelection) {
      refreshOrganizations();
    } else {
      setOrganizations([]);
      setCurrentOrganization(null);
      localStorage.removeItem("currentOrganizationId");
    }
  }, [isAuthenticated, user?.id, confirmedId, organizationSelection]);

  // Reconcile selection from the server-authoritative browser session.
  useEffect(() => {
    localStorage.removeItem("currentOrganizationId");
    setCurrentOrganization(null);
    if (
      user?.currentOrganizationId &&
      organizations.length > 0 &&
      !organizationSelection
    ) {
      const org = organizations.find(
        (o) => o.id === user.currentOrganizationId
      );
      if (org) {
        setCurrentOrganization(org);
        localStorage.setItem("currentOrganizationId", org.id);
      }
    }
  }, [organizations, user?.currentOrganizationId, organizationSelection]);

  const value: OrganizationContextType = {
    organizations,
    currentOrganization:
      !switchingOrganization &&
      !organizationSelection &&
      currentOrganization?.id === confirmedId
        ? currentOrganization
        : null,
    loading: loading || switchingOrganization,
    error,
    switchOrganization,
    refreshOrganizations,
    createOrganization,
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
};
