import {
  Box,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import React from "react";
import { useTranslation } from "react-i18next";
import { KEYS } from "../../i18n/keys";
import type { WorkStatus } from "../../api";

interface WorkItemFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: WorkStatus | "";
  onStatusFilterChange: (value: WorkStatus | "") => void;
  sortBy: string;
  onSortByChange: (value: string) => void;
}

export const WorkItemFilters: React.FC<WorkItemFiltersProps> = ({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortByChange,
}) => {
  const { t } = useTranslation();

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          gap: 2,
          alignItems: { xs: "stretch", md: "center" },
        }}
      >
        {/* Search Field */}
        <Box
          sx={{ flex: { md: "1 1 auto" }, width: { xs: "100%", md: "auto" } }}
        >
          <TextField
            fullWidth
            placeholder={t(KEYS.initiatives.filters.searchPlaceholder)}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
        </Box>

        {/* Status Filter */}
        <Box
          sx={{
            flex: { md: "0 0 200px" },
            width: { xs: "100%", md: "auto" },
          }}
        >
          <FormControl fullWidth>
            <InputLabel>{t(KEYS.initiatives.filters.status)}</InputLabel>
            <Select
              value={statusFilter}
              onChange={(e) =>
                onStatusFilterChange(e.target.value as WorkStatus | "")
              }
              label={t(KEYS.initiatives.filters.status)}
            >
              <MenuItem value="">
                {t(KEYS.initiatives.filters.statusAll)}
              </MenuItem>
              <MenuItem value="REFINING_DESCRIPTION">
                Refining Description
              </MenuItem>
              <MenuItem value="REFINING_DETAILS">Refining Details</MenuItem>
              <MenuItem value="REFINING_ACCEPTANCE_CRITERIA">
                Refining Acceptance Criteria
              </MenuItem>
              <MenuItem value="ACTIVE">Active</MenuItem>
              <MenuItem value="ON_HOLD">On Hold</MenuItem>
              <MenuItem value="COMPLETED">Completed</MenuItem>
              <MenuItem value="CANCELLED">Cancelled</MenuItem>
              <MenuItem value="SUPERSEDED">Superseded</MenuItem>
            </Select>
          </FormControl>
        </Box>

        {/* Sort Filter */}
        <Box
          sx={{
            flex: { md: "0 0 200px" },
            width: { xs: "100%", md: "auto" },
          }}
        >
          <FormControl fullWidth>
            <InputLabel>{t(KEYS.initiatives.filters.sort)}</InputLabel>
            <Select
              value={sortBy}
              onChange={(e) => onSortByChange(e.target.value)}
              label={t(KEYS.initiatives.filters.sort)}
            >
              <MenuItem value="created-desc">
                {t(KEYS.initiatives.filters.sortCreatedDesc)}
              </MenuItem>
              <MenuItem value="created-asc">
                {t(KEYS.initiatives.filters.sortCreatedAsc)}
              </MenuItem>
              <MenuItem value="name-asc">
                {t(KEYS.initiatives.filters.sortNameAsc)}
              </MenuItem>
              <MenuItem value="name-desc">
                {t(KEYS.initiatives.filters.sortNameDesc)}
              </MenuItem>
              <MenuItem value="status">
                {t(KEYS.initiatives.filters.sortStatus)}
              </MenuItem>
              <MenuItem value="priority">
                {t(KEYS.initiatives.filters.sortPriority)}
              </MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>
    </Paper>
  );
};
