import { useState, useCallback } from "react";
import type {
  IntegrationResponseDto,
  CreateIntegrationDto,
  UpdateIntegrationDto,
} from "../api";
import { apiClient } from "../clients";
import { extractErrorMessage } from "../utils/errorUtils";
import { useUserIdentity } from "./useUserIdentity";

interface UseIntegrationServiceReturn {
  integrations: IntegrationResponseDto[];
  loading: boolean;
  error: string | null;
  getAllIntegrations: (projectId: string) => Promise<void>;
  getIntegration: (
    projectId: string,
    integrationId: string
  ) => Promise<IntegrationResponseDto>;
  createIntegration: (
    projectId: string,
    data: CreateIntegrationDto
  ) => Promise<IntegrationResponseDto>;
  updateIntegration: (
    projectId: string,
    integrationId: string,
    data: UpdateIntegrationDto
  ) => Promise<IntegrationResponseDto>;
  deleteIntegration: (
    projectId: string,
    integrationId: string
  ) => Promise<void>;
  testExistingConnection: (
    projectId: string,
    integrationId: string
  ) => Promise<{ jobId: string }>;
}

export const useIntegrationService = (): UseIntegrationServiceReturn => {
  const [integrations, setIntegrations] = useState<IntegrationResponseDto[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userIdentity = useUserIdentity();
  const organizationId = userIdentity?.currentOrgId;

  const handleError = useCallback((error: unknown, defaultMessage: string) => {
    console.error(defaultMessage, error);
    const errorMessage = extractErrorMessage(error) ?? defaultMessage;
    setError(errorMessage);
    throw error;
  }, []);

  const getAllIntegrations = useCallback(
    async (projectId: string) => {
      if (!organizationId) {
        setError("Organization ID not available");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.findAllIntegrations({
          organizationId: organizationId,
          projectId: projectId,
        });
        setIntegrations(response.data.data || []);
      } catch (error) {
        handleError(error, "Failed to fetch integrations");
      } finally {
        setLoading(false);
      }
    },
    [organizationId, handleError]
  );

  const getIntegration = useCallback(
    async (
      projectId: string,
      integrationId: string
    ): Promise<IntegrationResponseDto> => {
      if (!organizationId) {
        throw new Error("Organization ID not available");
      }

      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.findOneIntegration({
          organizationId: organizationId,
          projectId: projectId,
          integrationId: integrationId,
        });
        return response.data.data!;
      } catch (error) {
        handleError(error, "Failed to fetch integration");
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [organizationId, handleError]
  );

  const createIntegration = useCallback(
    async (
      projectId: string,
      data: CreateIntegrationDto
    ): Promise<IntegrationResponseDto> => {
      if (!organizationId) {
        throw new Error("Organization ID not available");
      }

      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.createIntegration({
          organizationId: organizationId,
          projectId: projectId,
          createIntegrationDto: data,
        });
        return response.data.data!;
      } catch (error) {
        handleError(error, "Failed to create integration");
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [organizationId, handleError]
  );

  const updateIntegration = useCallback(
    async (
      projectId: string,
      integrationId: string,
      data: UpdateIntegrationDto
    ): Promise<IntegrationResponseDto> => {
      if (!organizationId) {
        throw new Error("Organization ID not available");
      }

      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.updateIntegration({
          organizationId: organizationId,
          projectId: projectId,
          integrationId: integrationId,
          updateIntegrationDto: data,
        });
        return response.data.data!;
      } catch (error) {
        handleError(error, "Failed to update integration");
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [organizationId, handleError]
  );

  const deleteIntegration = useCallback(
    async (projectId: string, integrationId: string): Promise<void> => {
      if (!organizationId) {
        throw new Error("Organization ID not available");
      }

      setLoading(true);
      setError(null);

      try {
        await apiClient.removeIntegration({
          organizationId: organizationId,
          projectId: projectId,
          integrationId: integrationId,
        });
      } catch (error) {
        handleError(error, "Failed to delete integration");
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [organizationId, handleError]
  );

  const testExistingConnection = useCallback(
    async (
      projectId: string,
      integrationId: string
    ): Promise<{ jobId: string }> => {
      if (!organizationId) {
        throw new Error("Organization ID not available");
      }

      setLoading(true);
      setError(null);

      try {
        const response = await apiClient.testIntegrationConnection({
          organizationId: organizationId,
          projectId: projectId,
          integrationId: integrationId,
        });
        return {
          jobId:
            typeof response.data.data === "string"
              ? response.data.data
              : "test-job",
        };
      } catch (error) {
        handleError(error, "Failed to test existing connection");
        throw error;
      } finally {
        setLoading(false);
      }
    },
    [organizationId, handleError]
  );

  return {
    integrations,
    loading,
    error,
    getAllIntegrations,
    getIntegration,
    createIntegration,
    updateIntegration,
    deleteIntegration,
    testExistingConnection,
  };
};
