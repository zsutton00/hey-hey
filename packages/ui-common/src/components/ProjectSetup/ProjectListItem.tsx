import React from "react";
import {
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  Chip,
  IconButton,
  CircularProgress,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import type { ProjectResponseDto } from "../../api";

export interface ProjectListItemProps {
  project: ProjectResponseDto;
  onSelect: (projectId: string) => void;
  onDelete: (project: ProjectResponseDto) => void;
  isDeleting: boolean;
  showBorder: boolean;
}

export const ProjectListItem: React.FC<ProjectListItemProps> = ({
  project,
  onSelect,
  onDelete,
  isDeleting,
  showBorder,
}) => {
  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <ListItem disablePadding>
      <ListItemButton
        onClick={() => onSelect(project.id)}
        sx={{
          borderBottom: showBorder ? "1px solid" : "none",
          borderColor: "divider",
          py: 2,
          pr: 1,
        }}
      >
        <ListItemText
          primary={
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="body1" fontWeight="medium">
                {project.name}
              </Typography>
              <Chip
                label={formatDate(project.createdAt)}
                size="small"
                variant="outlined"
                sx={{ ml: 1 }}
              />
            </Box>
          }
          secondary={
            <Box sx={{ mt: 0.5 }}>
              {project.description && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 0.5 }}
                >
                  {project.description}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                ID: {project.id}
              </Typography>
            </Box>
          }
        />
        <IconButton
          edge="end"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(project);
          }}
          disabled={isDeleting}
          sx={{
            ml: 1,
            color: "error.main",
            "&:hover": {
              backgroundColor: "error.light",
              color: "error.contrastText",
            },
          }}
        >
          {isDeleting ? <CircularProgress size={20} /> : <DeleteIcon />}
        </IconButton>
      </ListItemButton>
    </ListItem>
  );
};

export default ProjectListItem;
