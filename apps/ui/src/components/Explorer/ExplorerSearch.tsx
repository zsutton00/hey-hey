import React, { useEffect, useState } from "react";
import { Box, TextField, IconButton, InputAdornment } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import { useTranslation } from "react-i18next";
import { KEYS } from "@hey-hey/ui-common/i18n";
import type { ExplorerSearchProps } from "./types";

/**
 * Search component for the explorer sidebar.
 * Search is intentionally scoped to top-level menu items.
 */
export const ExplorerSearch: React.FC<ExplorerSearchProps> = ({
  searchTerm,
  onSearchChange,
  resultCount,
}) => {
  const { t } = useTranslation();
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm);

  useEffect(() => {
    setLocalSearchTerm(searchTerm);
  }, [searchTerm]);

  const handleSearchInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const value = event.target.value;
    setLocalSearchTerm(value);
    onSearchChange(value);
  };

  const handleClearSearch = () => {
    setLocalSearchTerm("");
    onSearchChange("");
  };

  return (
    <Box sx={{ p: 2, pt: 0 }}>
      <TextField
        fullWidth
        size="small"
        placeholder="Search menu items"
        value={localSearchTerm}
        onChange={handleSearchInputChange}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
          endAdornment: localSearchTerm ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={handleClearSearch}
                edge="end"
                aria-label={t(KEYS.explorer.clearSearch)}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        }}
        sx={{
          "& .MuiOutlinedInput-root": {
            bgcolor: "background.default",
          },
        }}
      />

      {resultCount !== undefined && (
        <Box sx={{ mt: 1, px: 0.5 }}>
          <Box
            component="span"
            sx={{
              fontSize: "0.75rem",
              color: "text.secondary",
              textTransform: "uppercase",
            }}
          >
            {t(KEYS.explorer.results, { count: resultCount })}
          </Box>
        </Box>
      )}
    </Box>
  );
};
