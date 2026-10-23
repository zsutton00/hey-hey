import { Chip } from "@mui/material";
import ScienceOutlinedIcon from "@mui/icons-material/ScienceOutlined";
import React from "react";
import { useTranslation } from "react-i18next";

/**
 * Marks saved eval attempt output. Display only: the server refuses to
 * approve or apply it whatever the UI shows.
 */
export const EvaluationOutputBadge: React.FC = () => {
  const { t } = useTranslation();
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={<ScienceOutlinedIcon />}
      label={t("eval.output.badge")}
      data-testid="evaluation-output-badge"
    />
  );
};
