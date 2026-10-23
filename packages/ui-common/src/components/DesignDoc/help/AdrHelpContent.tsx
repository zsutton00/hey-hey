import React from "react";
import { Box, Typography, Alert } from "@mui/material";
import DescriptionIcon from "@mui/icons-material/Description";
import GavelIcon from "@mui/icons-material/Gavel";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";
import { useTranslation } from "react-i18next";

export const AdrHelpContent: React.FC = () => {
  const { t } = useTranslation();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* What is an ADR */}
      <Box>
        <Typography variant="h6" gutterBottom>
          {t("designDoc.help.adr.concept.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t("designDoc.help.adr.concept.description")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("designDoc.help.adr.concept.purpose")}
        </Typography>
      </Box>

      {/* Three-Level Structure */}
      <Box>
        <Typography variant="h6" gutterBottom>
          {t("designDoc.help.adr.structure.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t("designDoc.help.adr.structure.description")}
        </Typography>

        {/* Context Section */}
        <Box
          sx={{
            display: "flex",
            gap: 2,
            mb: 2,
            p: 2,
            backgroundColor: "action.hover",
            borderRadius: 1,
          }}
        >
          <DescriptionIcon color="primary" />
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t("designDoc.help.adr.structure.context.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("designDoc.help.adr.structure.context.description")}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: "block" }}
            >
              {t("designDoc.help.adr.structure.context.status")}
            </Typography>
          </Box>
        </Box>

        {/* Arrow indicator */}
        <Box sx={{ display: "flex", justifyContent: "center", my: 1 }}>
          <TrendingFlatIcon
            color="action"
            sx={{ transform: "rotate(90deg)" }}
          />
        </Box>

        {/* Decision Section */}
        <Box
          sx={{
            display: "flex",
            gap: 2,
            mb: 2,
            p: 2,
            backgroundColor: "action.hover",
            borderRadius: 1,
          }}
        >
          <GavelIcon color="primary" />
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t("designDoc.help.adr.structure.decision.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("designDoc.help.adr.structure.decision.description")}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: "block" }}
            >
              {t("designDoc.help.adr.structure.decision.status")}
            </Typography>
          </Box>
        </Box>

        {/* Arrow indicator */}
        <Box sx={{ display: "flex", justifyContent: "center", my: 1 }}>
          <TrendingFlatIcon
            color="action"
            sx={{ transform: "rotate(90deg)" }}
          />
        </Box>

        {/* Consequences Section */}
        <Box
          sx={{
            display: "flex",
            gap: 2,
            p: 2,
            backgroundColor: "action.hover",
            borderRadius: 1,
          }}
        >
          <TrendingFlatIcon color="primary" />
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t("designDoc.help.adr.structure.consequences.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t("designDoc.help.adr.structure.consequences.description")}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 1, display: "block" }}
            >
              {t("designDoc.help.adr.structure.consequences.status")}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Usage Tips */}
      <Box>
        <Typography variant="h6" gutterBottom>
          {t("designDoc.help.adr.tips.title")}
        </Typography>

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Alert severity="info" variant="outlined">
            <Typography variant="body2">
              {t("designDoc.help.adr.tips.progressive")}
            </Typography>
          </Alert>

          <Alert severity="success" variant="outlined">
            <Typography variant="body2">
              {t("designDoc.help.adr.tips.aiAssistance")}
            </Typography>
          </Alert>

          <Alert severity="warning" variant="outlined">
            <Typography variant="body2">
              {t("designDoc.help.adr.tips.collaboration")}
            </Typography>
          </Alert>
        </Box>

        <Box
          component="ul"
          sx={{ pl: 3, mt: 2, "& li": { mb: 1 }, color: "text.secondary" }}
        >
          <Typography component="li" variant="body2">
            {t("designDoc.help.adr.tips.specific")}
          </Typography>
          <Typography component="li" variant="body2">
            {t("designDoc.help.adr.tips.alternatives")}
          </Typography>
          <Typography component="li" variant="body2">
            {t("designDoc.help.adr.tips.tradeoffs")}
          </Typography>
          <Typography component="li" variant="body2">
            {t("designDoc.help.adr.tips.revealButton")}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};
