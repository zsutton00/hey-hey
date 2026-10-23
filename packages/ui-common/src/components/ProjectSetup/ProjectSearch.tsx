import React from "react";
import { TextField, InputAdornment } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

export interface ProjectSearchProps {
  searchFilter: string;
  onSearchChange: (value: string) => void;
}

export const ProjectSearch: React.FC<ProjectSearchProps> = ({
  searchFilter,
  onSearchChange,
}) => {
  return (
    <TextField
      fullWidth
      placeholder="Search projects..."
      value={searchFilter}
      onChange={(e) => onSearchChange(e.target.value)}
      sx={{ mb: 2 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon />
            </InputAdornment>
          ),
        },
      }}
    />
  );
};

export default ProjectSearch;
