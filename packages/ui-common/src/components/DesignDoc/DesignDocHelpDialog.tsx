import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import React, { useState } from "react";
import {
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Tabs,
  Tab,
  Button,
  Typography,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useTranslation } from "react-i18next";
import type { SupportedDesignDocTemplate } from "../../types/designDocStatus";

export interface DesignDocHelpDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog closes */
  onClose: () => void;
  /** Design doc template type (ADR, BRAINSTORM, DECISION) */
  template: SupportedDesignDocTemplate;
  /** Callback to restart the walkthrough */
  onRestartWalkthrough?: () => void;
  /** Template-specific help content component */
  templateHelpContent?: React.ReactNode;
}

interface TabPanelProps {
  children: React.ReactNode;
  value: number;
  index: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
};

export const DesignDocHelpDialog: React.FC<DesignDocHelpDialogProps> = ({
  open,
  onClose,
  template,
  onRestartWalkthrough,
  templateHelpContent,
}) => {
  const { t } = useTranslation();
  const [currentTab, setCurrentTab] = useState(0);

  const handleTabChange = (
    _event: React.SyntheticEvent,
    newValue: number,
  ): void => {
    setCurrentTab(newValue);
  };

  const handleRestartWalkthrough = (): void => {
    if (onRestartWalkthrough) {
      onRestartWalkthrough();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: "60vh" },
      }}
      closeControl={
        <IconButton
          edge="end"
          onClick={onClose}
          aria-label={t("common.close")}
          size="small"
        >
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <HelpOutlineIcon color="primary" />
            <Typography variant="h6">
              {t("designDoc.help.dialog.title")}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <Divider />

      {onRestartWalkthrough && (
        <Box sx={{ px: 3, pt: 2 }}>
          <Button
            variant="outlined"
            startIcon={<PlayArrowIcon />}
            onClick={handleRestartWalkthrough}
            fullWidth
            size="medium"
          >
            {t("designDoc.help.restartWalkthrough")}
          </Button>
        </Box>
      )}

      <Box sx={{ borderBottom: 1, borderColor: "divider", px: 3, pt: 2 }}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          aria-label={t("designDoc.help.tabs.ariaLabel")}
        >
          <Tab label={t("designDoc.help.tabs.general")} />
          <Tab label={t("designDoc.help.tabs.templateSpecific")} />
        </Tabs>
      </Box>

      <DialogContent>
        <TabPanel value={currentTab} index={0}>
          {/* General Design Doc Help */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <Box>
              <Typography variant="h6" gutterBottom>
                {t("designDoc.help.general.overview.title")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("designDoc.help.general.overview.content")}
              </Typography>
            </Box>

            <Box>
              <Typography variant="h6" gutterBottom>
                {t("designDoc.help.general.features.title")}
              </Typography>
              <Box
                component="ul"
                sx={{ pl: 3, "& li": { mb: 1 }, color: "text.secondary" }}
              >
                <Typography component="li" variant="body2">
                  {t("designDoc.help.general.features.progressiveDisclosure")}
                </Typography>
                <Typography component="li" variant="body2">
                  {t("designDoc.help.general.features.collaboration")}
                </Typography>
                <Typography component="li" variant="body2">
                  {t("designDoc.help.general.features.aiAssistance")}
                </Typography>
                <Typography component="li" variant="body2">
                  {t("designDoc.help.general.features.versionHistory")}
                </Typography>
              </Box>
            </Box>

            <Box>
              <Typography variant="h6" gutterBottom>
                {t("designDoc.help.general.workflow.title")}
              </Typography>
              <Box
                component="ol"
                sx={{ pl: 3, "& li": { mb: 1 }, color: "text.secondary" }}
              >
                <Typography component="li" variant="body2">
                  {t("designDoc.help.general.workflow.step1")}
                </Typography>
                <Typography component="li" variant="body2">
                  {t("designDoc.help.general.workflow.step2")}
                </Typography>
                <Typography component="li" variant="body2">
                  {t("designDoc.help.general.workflow.step3")}
                </Typography>
                <Typography component="li" variant="body2">
                  {t("designDoc.help.general.workflow.step4")}
                </Typography>
              </Box>
            </Box>
          </Box>
        </TabPanel>

        <TabPanel value={currentTab} index={1}>
          {/* Template-Specific Help */}
          {templateHelpContent ? (
            templateHelpContent
          ) : (
            <Box>
              <Typography variant="body2" color="text.secondary">
                {t("designDoc.help.noTemplateHelp", { template })}
              </Typography>
            </Box>
          )}
        </TabPanel>
      </DialogContent>
    </Dialog>
  );
};
