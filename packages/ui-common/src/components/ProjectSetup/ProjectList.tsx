import React from "react";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Button,
} from "@mui/material";
import type { ProjectResponseDto } from "../../api";
import { ProjectSearch } from "./ProjectSearch";
import { ProjectListItem } from "./ProjectListItem";

export interface ProjectListProps {
  projects: ProjectResponseDto[];
  displayedProjects: ProjectResponseDto[];
  searchFilter: string;
  onSearchChange: (value: string) => void;
  onProjectSelect: (projectId: string) => void;
  onProjectDelete: (project: ProjectResponseDto) => void;
  deletingProjectId: string | null;
  showAll: boolean;
  onToggleShowAll: () => void;
  hasMoreProjects: boolean;
  remainingCount: number;
}

export const ProjectList: React.FC<ProjectListProps> = ({
  projects,
  displayedProjects,
  searchFilter,
  onSearchChange,
  onProjectSelect,
  onProjectDelete,
  deletingProjectId,
  showAll,
  onToggleShowAll,
  hasMoreProjects,
  remainingCount,
}) => {
  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Select a Project
      </Typography>

      <ProjectSearch
        searchFilter={searchFilter}
        onSearchChange={onSearchChange}
      />

      <Paper variant="outlined" sx={{ maxHeight: 400, overflow: "auto" }}>
        <List sx={{ p: 0 }}>
          {displayedProjects.map((project, index) => (
            <ProjectListItem
              key={project.id}
              project={project}
              onSelect={onProjectSelect}
              onDelete={onProjectDelete}
              isDeleting={deletingProjectId === project.id}
              showBorder={index < displayedProjects.length - 1}
            />
          ))}

          {displayedProjects.length === 0 && (
            <ListItem>
              <ListItemText
                primary={
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    align="center"
                  >
                    {searchFilter
                      ? "No projects match your search"
                      : "No projects found"}
                  </Typography>
                }
              />
            </ListItem>
          )}
        </List>
      </Paper>

      {hasMoreProjects && (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <Button variant="text" onClick={onToggleShowAll} size="small">
            {showAll ? "Show Less" : `Show ${remainingCount} More`}
          </Button>
        </Box>
      )}

      {projects.length > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: 1, display: "block" }}
        >
          {projects.length} project{projects.length !== 1 ? "s" : ""} found
        </Typography>
      )}
    </Box>
  );
};

export default ProjectList;
