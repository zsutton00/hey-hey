import { Box, Divider, Typography } from "@mui/material";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../i18n/keys";
import {
  IntegrationState,
  IntegrationTargetType,
  IntegrationType,
  type CreateIntegrationDto,
} from "../../../api";
import { useIntegrationService } from "../../../hooks/useIntegrationService";
import { IntegrationTestService } from "../../../services/integrationTestService";
import { getErrorMessage } from "../../../utils/errorUtils";

// Base components
import { IntegrationDialogBase } from "./base/IntegrationDialogBase";
import { IntegrationFormBase } from "./base/IntegrationFormBase";
import { IntegrationTestButton } from "./base/IntegrationTestButton";

// Integration-specific components
import { GitHubTokenPermissions } from "./github/GitHubTokenPermissions";
import { JiraConnectionHelp } from "./jira/JiraConnectionHelp";
import {
  JiraIntegrationForm,
  type JiraFormData,
} from "./jira/JiraIntegrationForm";

// Types
import type {
  BaseFormData,
  TestResult,
  GitHubIntegrationConfig,
  JiraIntegrationConfig,
} from "./types";

interface CreateIntegrationDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  projectId: string;
  selectedType: IntegrationType;
}

const DEFAULT_JIRA_DATA: JiraFormData = {
  serverUrl: "",
  email: "",
  apiToken: "",
  projectKey: "",
  instanceType: "cloud",
};

type SupportedIntegrationConfig =
  | GitHubIntegrationConfig
  | JiraIntegrationConfig
  | Record<string, never>;

type CreateIntegrationConfig = CreateIntegrationDto["config"];

const asCreateIntegrationConfig = (
  config: SupportedIntegrationConfig
): CreateIntegrationConfig => config as unknown as CreateIntegrationConfig;

export const CreateIntegrationDialog: React.FC<
  CreateIntegrationDialogProps
> = ({ open, onClose, onSuccess, projectId, selectedType }) => {
  const { t } = useTranslation();
  const [baseData, setBaseData] = useState<BaseFormData>({
    name: "",
    description: "",
  });
  const [jiraData, setJiraData] = useState<JiraFormData>(DEFAULT_JIRA_DATA);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const { createIntegration } = useIntegrationService();

  useEffect(() => {
    if (!open) {
      // Reset form when dialog closes
      setBaseData({ name: "", description: "" });
      setJiraData(DEFAULT_JIRA_DATA);
      setTestResult(null);
      setIsTestingConnection(false);
      setIsCreating(false);
    }
  }, [open]);

  const isFormValid = (): boolean => {
    if (!baseData.name?.trim()) return false;

    switch (selectedType) {
      case "GITHUB":
        // OAuth flow - only name is required
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

  const buildCreateDto = (): CreateIntegrationDto => {
    let config: SupportedIntegrationConfig;

    switch (selectedType) {
      case "GITHUB":
        // OAuth flow - create with empty config, OAuth tokens added later
        config = {} as GitHubIntegrationConfig;
        break;
      case "JIRA":
        config = {
          type: "JIRA",
          serverUrl: jiraData.serverUrl,
          email: jiraData.email,
          apiToken: jiraData.apiToken,
          instanceType: jiraData.instanceType,
          ...(jiraData.projectKey ? { projectKey: jiraData.projectKey } : {}),
        } satisfies JiraIntegrationConfig;
        break;
      default:
        config = {};
    }

    return {
      name: baseData.name,
      description: baseData.description || undefined,
      type: selectedType,
      config: asCreateIntegrationConfig(config),
      state: IntegrationState.Active,
      targetType: IntegrationTargetType.User, // Default target type
    };
  };

  const handleTestConnection = async () => {
    if (!isFormValid()) {
      setTestResult({
        success: false,
        message: t(KEYS.integrations.forms.fillRequiredFields),
      });
      return;
    }

    setIsTestingConnection(true);
    setTestResult(null);

    try {
      let result: TestResult;

      switch (selectedType) {
        case "GITHUB":
          // OAuth flow - skip connection test during creation
          result = {
            success: true,
            message: t(KEYS.integrations.github.oauthFlowDescription),
          };
          break;
        case "JIRA":
          result = await IntegrationTestService.testJiraConnection(jiraData);
          break;
        default:
          result = {
            success: false,
            message: t("integrations.forms.connectionNotImplemented", {
              type: selectedType,
            }),
          };
      }

      setTestResult(result);
    } catch (error: unknown) {
      console.error("Connection test error:", error);
      setTestResult({
        success: false,
        message: `${t(
          KEYS.integrations.forms.connectionTestFailed
        )}: ${getErrorMessage(error, "Unknown error occurred")}`,
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSubmit = async () => {
    if (!isFormValid()) return;

    setIsCreating(true);

    try {
      const createDto = buildCreateDto();
      await createIntegration(projectId, createDto);
      onSuccess();
    } catch (error: unknown) {
      setTestResult({
        success: false,
        message: getErrorMessage(error, "Failed to create integration."),
      });
    } finally {
      setIsCreating(false);
    }
  };

  const renderSetupContent = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Basic Information */}
      <IntegrationFormBase
        name={baseData.name}
        description={baseData.description}
        onNameChange={(name) => setBaseData({ ...baseData, name })}
        onDescriptionChange={(description) =>
          setBaseData({ ...baseData, description })
        }
        namePlaceholder={
          selectedType === "GITHUB"
            ? t(KEYS.integrations.dialog.placeholders.githubRepo)
            : t(KEYS.integrations.dialog.placeholders.jiraProject)
        }
      />

      <Divider />

      {/* Integration-specific Configuration */}
      {selectedType === "GITHUB" && (
        <Box>
          <Typography variant="body2" color="text.secondary">
            {t(KEYS.integrations.github.oauthFlowDescription)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t(KEYS.integrations.github.oauthRedirectInfo)}
          </Typography>
        </Box>
      )}

      {selectedType === "JIRA" && (
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
    switch (selectedType) {
      case "GITHUB":
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              {t(KEYS.integrations.github.configuration)}
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              After creating this integration, you'll be able to connect your
              GitHub account using OAuth. This provides secure access to your
              repositories without storing tokens manually.
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
          <Typography>{t(KEYS.integrations.forms.noHelpAvailable)}</Typography>
        );
    }
  };

  return (
    <IntegrationDialogBase
      open={open}
      onClose={onClose}
      integrationType={selectedType}
      title={t(KEYS.integrations.dialog.add)}
      isCreating={isCreating}
      isFormValid={isFormValid()}
      onSubmit={handleSubmit}
      submitButtonText={t(KEYS.integrations.dialog.createIntegration)}
      setupContent={renderSetupContent()}
      helpContent={renderHelpContent()}
    />
  );
};
