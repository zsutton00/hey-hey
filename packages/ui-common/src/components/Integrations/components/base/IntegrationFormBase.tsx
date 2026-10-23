import React from "react";
import { Box, TextField, Typography } from "@mui/material";

interface IntegrationFormBaseProps {
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  nameLabel?: string;
  namePlaceholder?: string;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
}

export const IntegrationFormBase: React.FC<IntegrationFormBaseProps> = ({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  nameLabel = "Integration Name",
  namePlaceholder,
  descriptionLabel = "Description",
  descriptionPlaceholder = "Optional description of this integration",
}) => {
  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Basic Information
      </Typography>

      <TextField
        fullWidth
        label={nameLabel}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        required
        sx={{ mb: 2 }}
        placeholder={namePlaceholder}
      />

      <TextField
        fullWidth
        label={descriptionLabel}
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        multiline
        rows={2}
        placeholder={descriptionPlaceholder}
      />
    </Box>
  );
};
