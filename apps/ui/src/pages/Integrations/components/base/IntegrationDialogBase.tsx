import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import React, { useState } from "react";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Button,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import HelpIcon from "@mui/icons-material/Help";
import CloseIcon from "@mui/icons-material/Close";
import type { IntegrationType } from "@hey-hey/ui-common/api";
import AnimatedButton from "../../../../components/AnimatedButton";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`integration-tabpanel-${index}`}
      aria-labelledby={`integration-tab-${index}`}
    >
      {value === index && children}
    </div>
  );
};

interface IntegrationDialogBaseProps {
  open: boolean;
  onClose: () => void;
  integrationType: IntegrationType;
  title: string;
  isCreating?: boolean;
  isFormValid: boolean;
  onSubmit: () => void;
  submitButtonText: string;
  setupContent: React.ReactNode;
  helpContent: React.ReactNode;
  showActions?: boolean;
}

export const IntegrationDialogBase: React.FC<IntegrationDialogBaseProps> = ({
  open,
  onClose,
  integrationType,
  title,
  isCreating = false,
  isFormValid,
  onSubmit,
  submitButtonText,
  setupContent,
  helpContent,
  showActions = true,
}) => {
  const [activeTab, setActiveTab] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const buttonLabel = isCreating
    ? `${submitButtonText.includes("Create") ? "Creating" : "Updating"}...`
    : submitButtonText;

  const getIntegrationDisplayName = (type: IntegrationType) => {
    switch (type) {
      case "GITHUB":
        return "GitHub";
      case "JIRA":
        return "Jira";
      case "SLACK":
        return "Slack";
      case "TEAMS":
        return "Microsoft Teams";
      case "CONFLUENCE":
        return "Confluence";
      case "LINEAR":
        return "Linear";
      case "NOTION":
        return "Notion";
      case "FIGMA":
        return "Figma";
      case "ASANA":
        return "Asana";
      case "TRELLO":
        return "Trello";
      case "DISCORD":
        return "Discord";
      case "WEBHOOK":
        return "Webhook";
      default:
        return type;
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      closeControl={
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      }
    >
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h6">
            {title} {getIntegrationDisplayName(integrationType)} Integration
          </Typography>
        </Box>
      </DialogTitle>

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: "divider", px: 3 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          aria-label="integration setup tabs"
        >
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <SettingsIcon fontSize="small" />
                Setup
              </Box>
            }
            id="integration-tab-0"
            aria-controls="integration-tabpanel-0"
          />
          <Tab
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <HelpIcon fontSize="small" />
                Help
              </Box>
            }
            id="integration-tab-1"
            aria-controls="integration-tabpanel-1"
          />
        </Tabs>
      </Box>

      <DialogContent sx={{ p: 0 }}>
        {/* Setup Tab */}
        <TabPanel value={activeTab} index={0}>
          <Box sx={{ p: 3 }}>{setupContent}</Box>
        </TabPanel>

        {/* Help Tab */}
        <TabPanel value={activeTab} index={1}>
          <Box sx={{ p: 3 }}>{helpContent}</Box>
        </TabPanel>
      </DialogContent>

      {/* Only show actions on Setup tab */}
      {showActions && activeTab === 0 && (
        <DialogActions>
          <Button onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
          <AnimatedButton
            onClick={onSubmit}
            disabled={!isFormValid || isCreating}
            loading={isCreating}
            variant="contained"
          >
            {buttonLabel}
          </AnimatedButton>
        </DialogActions>
      )}
    </Dialog>
  );
};
