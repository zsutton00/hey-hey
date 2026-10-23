import React, { useState, useEffect } from "react";
import { Box, Typography, Divider } from "@mui/material";
import {
  IntegrationTargetType,
  type IntegrationResponseDto,
  type UpdateIntegrationDto,
} from "../../../api";
import { useIntegrationService } from "../../../hooks/useIntegrationService";
import { IntegrationTestService } from "../../../services/integrationTestService";
import { useUserIdentity } from "../../../hooks";
import { getErrorMessage } from "../../../utils/errorUtils";

// Base components
import { IntegrationDialogBase } from "./base/IntegrationDialogBase";
import { IntegrationFormBase } from "./base/IntegrationFormBase";
import { IntegrationTestButton } from "./base/IntegrationTestButton";

// Integration-specific components
import { GitHubIntegrationForm } from "./github/GitHubIntegrationForm";
import { GitHubTokenPermissions } from "./github/GitHubTokenPermissions";
import {
  JiraIntegrationForm,
  type JiraFormData,
} from "./jira/JiraIntegrationForm";
import { JiraConnectionHelp } from "./jira/JiraConnectionHelp";

// Types
import type {
  BaseFormData,
  TestResult,
  GitHubIntegrationConfig,
  JiraIntegrationConfig,
} from "./types";

interface EditIntegrationDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  integration: IntegrationResponseDto;
}

export const EditIntegrationDialog: React.FC<EditIntegrationDialogProps> = ({
  open,
  onClose,
  onSuccess,
  integration,
}) => {
  const [baseData, setBaseData] = useState<BaseFormData>({
    name: "",
    description: "",
  });
  const [jiraData, setJiraData] = useState<JiraFormData>({
    serverUrl: "",
    email: "",
    apiToken: "",
    projectKey: "",
    instanceType: "cloud",
  });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const { updateIntegration } = useIntegrationService();
  const { currentOrgId } = useUserIdentity() || {};

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  const parseJiraConfig = (config: unknown): Partial<JiraIntegrationConfig> => {
    if (!isRecord(config)) {
      return {};
    }

    return {
      serverUrl:
        typeof config.serverUrl === "string" ? config.serverUrl : undefined,
      email: typeof config.email === "string" ? config.email : undefined,
      apiToken:
        typeof config.apiToken === "string" ? config.apiToken : undefined,
      projectKey:
        typeof config.projectKey === "string" ? config.projectKey : undefined,
      instanceType:
        config.instanceType === "cloud" || config.instanceType === "server"
          ? config.instanceType
          : undefined,
    };
  };

  useEffect(() => {
    if (open && integration) {
      // Populate form data from integration
      setBaseData({
        name: integration.name,
        description: integration.description || "",
      });

      // Populate integration-specific data
      const config = integration.config;
      switch (integration.type) {
        case "GITHUB":
          // OAuth flow - no form data needed
          break;
        case "JIRA":
          {
            const parsedConfig = parseJiraConfig(config);
            setJiraData({
              serverUrl: parsedConfig.serverUrl || "",
              email: parsedConfig.email || "",
              apiToken: parsedConfig.apiToken || "",
              projectKey: parsedConfig.projectKey || "",
              instanceType: parsedConfig.instanceType || "cloud",
            });
          }
          break;
      }

      setTestResult(null);
      setIsTestingConnection(false);
      setIsUpdating(false);
    }
  }, [open, integration]);

  const isFormValid = (): boolean => {
    if (!baseData.name?.trim()) return false;

    switch (integration.type) {
      case "GITHUB":
        // OAuth flow - only name required for updates
        return true;
      case "JIRA":
        return !!(
          jiraData.serverUrl?.trim() &&
          jiraData.email?.trim() &&
          jiraData.apiToken?.trim()
        );
      default:
        return false;
    }
  };

  const buildUpdateDto = (): UpdateIntegrationDto => {
    let config: GitHubIntegrationConfig | JiraIntegrationConfig | undefined;

    switch (integration.type) {
      case "GITHUB":
        // OAuth flow - preserve existing config, don't overwrite OAuth tokens
        config = undefined; // Don't update config from edit dialog
        break;
      case "JIRA":
        config = {
          type: "JIRA",
          serverUrl: jiraData.serverUrl,
          email: jiraData.email,
          apiToken: jiraData.apiToken,
          instanceType: jiraData.instanceType,
        };
        if (jiraData.projectKey) {
          config.projectKey = jiraData.projectKey;
        }
        break;
      default:
        config = undefined;
    }

    return {
      name: baseData.name,
      description: baseData.description || undefined,
      config,
    };
  };

  const handleTestConnection = async () => {
    if (!isFormValid()) {
      setTestResult({
        success: false,
        message: "Please fill in all required fields first.",
      });
      return;
    }

    if (!currentOrgId) {
      setTestResult({
        success: false,
        message: "Organization ID not available. Please refresh and try again.",
      });
      return;
    }

    setIsTestingConnection(true);
    setTestResult(null);

    try {
      // For existing integrations, we can test using the saved configuration
      // or use the updated form data to test the new configuration
      let result: TestResult;

      switch (integration.type) {
        case "GITHUB":
          // OAuth flow - skip connection test
          result = {
            success: true,
            message: "OAuth connection managed separately",
          };
          break;
        case "JIRA":
          // Test with the updated form data
          result = await IntegrationTestService.testJiraConnection(jiraData);
          break;
        default:
          // Fall back to testing the existing integration
          result = await IntegrationTestService.testExistingIntegration(
            integration.projectId || "",
            integration.id,
            currentOrgId
          );
      }

      setTestResult(result);
    } catch (error: unknown) {
      console.error("Connection test error:", error);
      setTestResult({
        success: false,
        message: `Test failed: ${getErrorMessage(
          error,
          "Unknown error occurred"
        )}`,
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSubmit = async () => {
    if (!isFormValid()) return;

    setIsUpdating(true);

    try {
      const updateDto = buildUpdateDto();
      await updateIntegration(
        integration.projectId || "",
        integration.id,
        updateDto
      );
      onSuccess();
    } catch (error: unknown) {
      setTestResult({
        success: false,
        message: getErrorMessage(error, "Failed to update integration."),
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const renderSetupContent = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Integration Type Display */}
      <Box>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Integration Type
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {integration.type} (cannot be changed)
        </Typography>
      </Box>

      <Divider />

      {/* Basic Information */}
      <IntegrationFormBase
        name={baseData.name}
        description={baseData.description}
        onNameChange={(name) => setBaseData({ ...baseData, name })}
        onDescriptionChange={(description) =>
          setBaseData({ ...baseData, description })
        }
      />

      <Divider />

      {/* Integration-specific Configuration */}
      {integration.type === "GITHUB" && currentOrgId && (
        <GitHubIntegrationForm
          integration={integration}
          organizationId={currentOrgId}
          projectId={integration.projectId || ""}
          onConnectionChange={onSuccess}
        />
      )}

      {integration.type === "JIRA" && (
        <JiraIntegrationForm
          formData={jiraData}
          onFormChange={(updates) => setJiraData({ ...jiraData, ...updates })}
        />
      )}

      <Divider />

      {/* Test Connection - Skip for GitHub OAuth */}
      {integration.type !== "GITHUB" && (
        <IntegrationTestButton
          onTest={handleTestConnection}
          isFormValid={isFormValid()}
          isTestingConnection={isTestingConnection}
          testResult={testResult}
        />
      )}
    </Box>
  );

  const renderHelpContent = () => {
    switch (integration.type) {
      case "GITHUB":
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              GitHub OAuth Integration
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Use the OAuth connection controls to manage your GitHub account
              connection. OAuth provides secure, token-free authentication.
            </Typography>
            <GitHubTokenPermissions
              integrationType={IntegrationTargetType.User}
            />
          </Box>
        );
      case "JIRA":
        return <JiraConnectionHelp instanceType={jiraData.instanceType} />;
      default:
        return (
          <Typography>No help available for this integration type.</Typography>
        );
    }
  };

  return (
    <IntegrationDialogBase
      open={open}
      onClose={onClose}
      integrationType={integration.type}
      title="Edit"
      isCreating={isUpdating}
      isFormValid={isFormValid()}
      onSubmit={handleSubmit}
      submitButtonText="Update Integration"
      setupContent={renderSetupContent()}
      helpContent={renderHelpContent()}
    />
  );
};
