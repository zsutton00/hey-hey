import React, { useState, useEffect } from "react";
import { Box, Typography, Divider } from "@mui/material";
import {
  type IntegrationResponseDto,
  type UpdateIntegrationDto,
} from "@hey-hey/ui-common/api";
import { useIntegrationService } from "@hey-hey/ui-common/hooks";
import { IntegrationTestService } from "@hey-hey/ui-common/services";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";

// Base components
import { IntegrationDialogBase } from "./base/IntegrationDialogBase";
import { IntegrationFormBase } from "./base/IntegrationFormBase";
import { IntegrationTestButton } from "./base/IntegrationTestButton";

// Integration-specific components
import { GitHubIntegrationForm } from "@hey-hey/ui-common/components";
import {
  JiraIntegrationForm,
  type JiraFormData,
} from "./jira/JiraIntegrationForm";
import { JiraConnectionHelp } from "./jira/JiraConnectionHelp";

// Types
import type { BaseFormData, TestResult } from "./types";

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

  useEffect(() => {
    if (open && integration) {
      // Populate form data from integration
      setBaseData({
        name: integration.name,
        description: integration.description || "",
      });

      // Populate integration-specific data
      switch (integration.type) {
        case "GITHUB":
          // GitHub uses OAuth form from ui-common - no local state needed
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
        // GitHub validation only requires name - OAuth handled separately
        return true;
      default:
        return false;
    }
  };

  const buildUpdateDto = (): UpdateIntegrationDto => {
    let config: any;

    switch (integration.type) {
      case "GITHUB":
        // GitHub config managed by OAuth flow - don't override
        // Only update name/description, preserve existing OAuth tokens
        config = integration.config || {};
        break;
      case "JIRA":
        config = {
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
        config = {};
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
          // GitHub connection status shown in OAuth form - test not needed
          result = {
            success: true,
            message:
              "GitHub connection status is displayed in the OAuth section below.",
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
            currentOrgId,
          );
      }

      setTestResult(result);
    } catch (error: any) {
      console.error("Connection test error:", error);
      setTestResult({
        success: false,
        message: `Test failed: ${error.message || "Unknown error occurred"}`,
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
        updateDto,
      );
      onSuccess();
    } catch (error: any) {
      setTestResult({
        success: false,
        message:
          error.response?.data?.message ||
          error.message ||
          "Failed to update integration.",
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
      {integration.type === "GITHUB" && (
        <GitHubIntegrationForm
          integration={integration}
          organizationId={currentOrgId || ""}
          projectId={integration.projectId || ""}
          onConnectionChange={() => {
            // Optionally refresh integration data after OAuth connection changes
            onSuccess();
          }}
        />
      )}

      {integration.type === "JIRA" && (
        <JiraIntegrationForm
          formData={jiraData}
          onFormChange={(updates) => setJiraData({ ...jiraData, ...updates })}
        />
      )}

      <Divider />

      {/* Test Connection */}
      <IntegrationTestButton
        onTest={handleTestConnection}
        isFormValid={isFormValid()}
        isTestingConnection={isTestingConnection}
        testResult={testResult}
      />
    </Box>
  );

  const renderHelpContent = () => {
    switch (integration.type) {
      case "GITHUB":
        return (
          <Box>
            <Typography variant="h6" sx={{ mb: 2 }}>
              GitHub OAuth Connection
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              This integration uses OAuth for secure authentication with GitHub.
              Click the "Connect GitHub Account" button to authorize access, or
              use the disconnect/reconnect controls to manage your connection.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The connection status shows your connected organization, granted
              permissions, and token expiration details.
            </Typography>
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
