import React from "react";
import { TextField, InputAdornment } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import type { IntegrationSearchProps } from "./types";

export const IntegrationSearch: React.FC<IntegrationSearchProps> = ({
  searchTerm,
  onSearchChange,
  disabled = false,
}) => {
  return (
    <TextField
      placeholder="Search integrations..."
      value={searchTerm}
      onChange={(e) => onSearchChange(e.target.value)}
      disabled={disabled}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon />
          </InputAdornment>
        ),
      }}
      sx={{ mb: 2, minWidth: 400 }}
    />
  );
};
