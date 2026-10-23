import React from "react";
import {
  Box,
  TextField,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Typography,
  Link,
  Alert,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../../../i18n/keys";

export interface JiraFormData {
  serverUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  instanceType: "cloud" | "server";
}

interface JiraIntegrationFormProps {
  formData: JiraFormData;
  onFormChange: (updates: Partial<JiraFormData>) => void;
}

export const JiraIntegrationForm: React.FC<JiraIntegrationFormProps> = ({
  formData,
  onFormChange,
}) => {
  const { t } = useTranslation();

  const handleFieldChange =
    (field: keyof JiraFormData) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFormChange({ [field]: event.target.value });
    };

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {t(KEYS.integrations.jira.configuration)}
      </Typography>

      <FormControl component="fieldset" sx={{ mb: 2 }}>
        <FormLabel component="legend">
          {t(KEYS.integrations.jira.instanceType)}
        </FormLabel>
        <RadioGroup
          value={formData.instanceType}
          onChange={(e) =>
            onFormChange({
              instanceType: e.target.value as "cloud" | "server",
            })
          }
          row
        >
          <FormControlLabel
            value="cloud"
            control={<Radio />}
            label={t(KEYS.integrations.jira.jiraCloud)}
          />
          <FormControlLabel
            value="server"
            control={<Radio />}
            label={t(KEYS.integrations.jira.jiraServerDataCenter)}
          />
        </RadioGroup>
      </FormControl>

      <TextField
        fullWidth
        label={
          formData.instanceType === "cloud"
            ? t(KEYS.integrations.jira.jiraCloudUrl)
            : t(KEYS.integrations.jira.jiraServerUrl)
        }
        value={formData.serverUrl}
        onChange={handleFieldChange("serverUrl")}
        required
        sx={{ mb: 2 }}
        placeholder={
          formData.instanceType === "cloud"
            ? t(KEYS.integrations.jira.jiraCloudUrlPlaceholder)
            : t(KEYS.integrations.jira.jiraServerUrlPlaceholder)
        }
        helperText={
          formData.instanceType === "cloud"
            ? t(KEYS.integrations.jira.jiraCloudUrlHelp)
            : t(KEYS.integrations.jira.jiraServerUrlHelp)
        }
      />

      <TextField
        fullWidth
        label={t(KEYS.integrations.jira.emailAddress)}
        type="email"
        value={formData.email}
        onChange={handleFieldChange("email")}
        required
        sx={{ mb: 2 }}
        placeholder={t(KEYS.integrations.jira.emailPlaceholder)}
        helperText={t(KEYS.integrations.jira.emailHelp)}
      />

      <TextField
        fullWidth
        label={
          formData.instanceType === "cloud"
            ? t(KEYS.integrations.jira.apiToken)
            : t(KEYS.integrations.jira.passwordApiToken)
        }
        type="password"
        value={formData.apiToken}
        onChange={handleFieldChange("apiToken")}
        required
        sx={{ mb: 2 }}
        helperText={
          formData.instanceType === "cloud" ? (
            <Box>
              {t(KEYS.integrations.jira.apiTokenHelp)}{" "}
              <Link
                href="https://id.atlassian.com/manage-profile/security/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
              >
                Atlassian Account Settings
              </Link>
            </Box>
          ) : (
            t(KEYS.integrations.jira.serverPasswordHelp)
          )
        }
      />

      <TextField
        fullWidth
        label={t(KEYS.integrations.jira.projectKey)}
        value={formData.projectKey}
        onChange={handleFieldChange("projectKey")}
        placeholder={t(KEYS.integrations.jira.projectKeyPlaceholder)}
        helperText={t(KEYS.integrations.jira.projectKeyHelp)}
        sx={{ mb: 2 }}
      />

      {formData.instanceType === "server" && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t(KEYS.integrations.jira.serverAlert)}
        </Alert>
      )}
    </Box>
  );
};
