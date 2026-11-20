import {
  Alert,
  Box,
  Button,
  MenuItem,
  Select,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkItemTypeDefinitionDto } from "../../api/api";
import {
  getWorkItemStatusChoices,
  getWorkItemStatusLabel,
} from "../../utils/workItemStatusVocabulary";

export interface RetainedStatusPanelProps {
  /** The saved status the type no longer defines. */
  status: string;
  definition: WorkItemTypeDefinitionDto;
  disabled?: boolean;
  onReplace: (status: string) => void;
}

/**
 * Warns that an item's saved status was removed from its type and offers the
 * type's current statuses (and Archived) as an explicit replacement. The item
 * keeps its saved status until a replacement is saved.
 */
export const RetainedStatusPanel: React.FC<RetainedStatusPanelProps> = ({
  status,
  definition,
  disabled = false,
  onReplace,
}) => {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("");
  const choices = getWorkItemStatusChoices(definition);

  return (
    <Alert
      severity="warning"
      data-testid="retained-status-panel"
      sx={{ width: "100%" }}
    >
      <Typography variant="subtitle2" data-testid="retained-status-name">
        {status}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {t("retainedStatus.needsNewStatus", "Needs a new status")}
      </Typography>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
        <Select
          size="small"
          displayEmpty
          value={selected}
          disabled={disabled}
          onChange={(event) => setSelected(event.target.value)}
          inputProps={{ "data-testid": "retained-status-select" }}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="" disabled>
            {t("retainedStatus.choose", "Choose a new status")}
          </MenuItem>
          {choices.map((choice) => (
            <MenuItem key={choice} value={choice}>
              {getWorkItemStatusLabel(choice, definition)}
            </MenuItem>
          ))}
        </Select>
        <Button
          variant="contained"
          size="small"
          disabled={disabled || selected === ""}
          onClick={() => onReplace(selected)}
          data-testid="retained-status-save"
        >
          {t("retainedStatus.save", "Save status")}
        </Button>
      </Box>
    </Alert>
  );
};
