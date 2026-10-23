import { useMemo } from "react";
import type { IntegrationResponseDto } from "../../../../api";
import type { Integration } from "./types";

export const useApiIntegrationsAsForm = (
  apiIntegrations: IntegrationResponseDto[]
): Integration[] => {
  return useMemo(() => {
    // Safety check: ensure apiIntegrations is an array
    if (!apiIntegrations || !Array.isArray(apiIntegrations)) {
      console.debug("apiIntegrations is not an array:", apiIntegrations);
      return [];
    }

    try {
      console.log(
        "Converting API integrations to form format:",
        apiIntegrations
      );

      const converted = apiIntegrations.map((apiIntegration) => {
        const config =
          apiIntegration.config && typeof apiIntegration.config === "object"
            ? (apiIntegration.config as unknown as Record<string, unknown>)
            : {};

        return {
          id: apiIntegration.id,
          type: apiIntegration.type.toLowerCase(), // Convert IntegrationType.Github to 'github'
          name: apiIntegration.name,
          config,
          isConfigured: true,
          createdAt: apiIntegration.createdAt || new Date().toISOString(),
        };
      });

      console.log("Converted API integrations:", converted);
      return converted;
    } catch (error) {
      console.error(
        "Error converting API integrations:",
        error,
        apiIntegrations
      );
      return [];
    }
  }, [apiIntegrations]);
};
