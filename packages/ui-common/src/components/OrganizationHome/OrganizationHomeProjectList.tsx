import React from "react";
import { Box, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import type { ProjectResponseDto } from "../../api";
import { EntityStarToggle } from "../Entity";
import { EntityType, ProjectStatus } from "../../api";
import { projectCapabilitiesForRole } from "../../hooks";
import { CancelOnboardingAction } from "../shared/CancelOnboardingAction";
import { ProjectStatusChip, ProjectUpdatedAt } from "../shared/ProjectMetadata";
interface ProjectListProps {
  projects: ProjectResponseDto[];
  pathForProject: (
    project: Pick<ProjectResponseDto, "id" | "status">,
  ) => string;
  organizationId: string;
}

export const OrganizationHomeProjectList: React.FC<ProjectListProps> = ({
  projects,
  pathForProject,
  organizationId,
}) => (
  <Box
    role="list"
    aria-label="Projects"
    data-testid="organization-home-projects-list"
    sx={{
      minWidth: 0,
    }}
  >
    {projects.map((project) => (
      <Box
        key={project.id}
        role="listitem"
        data-testid="organization-home-project-item"
        data-project-id={project.id}
        sx={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid",
          borderColor: "divider",
          "&:last-child": { borderBottom: 0 },
        }}
      >
        <Box
          component={RouterLink}
          to={pathForProject(project)}
          data-testid="organization-home-project-link"
          data-project-id={project.id}
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              sm: "minmax(16rem, 0.9fr) minmax(0, 1.8fr)",
            },
            gridTemplateRows: { xs: "auto auto", sm: "auto" },
            columnGap: { xs: 1.5, sm: 3 },
            rowGap: { xs: 0.5, sm: 0 },
            alignItems: "center",
            flex: 1,
            minWidth: 0,
            minHeight: { sm: 88 },
            px: { xs: 0, sm: 2.5 },
            py: 2,
            color: "text.primary",
            textDecoration: "none",
            transition: "background-color 120ms ease",
            "&:hover": { bgcolor: "action.hover" },
            "&:focus-visible": {
              outline: "2px solid",
              outlineColor: "heyhey.main",
              outlineOffset: -2,
            },
          }}
        >
          <Box
            data-testid="organization-home-project-details"
            sx={{ minWidth: 0 }}
          >
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ minWidth: 0 }}
            >
              <Typography
                component="h3"
                variant="h6"
                fontWeight={700}
                sx={{ overflowWrap: "anywhere", minWidth: 0 }}
              >
                {project.name}
              </Typography>
              <ProjectStatusChip status={project.status} />
            </Stack>
            <Box sx={{ mt: 0.5, color: "text.secondary" }}>
              <ProjectUpdatedAt updatedAt={project.updatedAt} />
            </Box>
          </Box>
          {project.description && (
            <Typography
              variant="body1"
              color="text.secondary"
              data-testid="organization-home-project-description"
              sx={{
                gridColumn: { xs: 1, sm: 2 },
                gridRow: { xs: 2, sm: 1 },
                minWidth: 0,
                overflowWrap: "anywhere",
                lineHeight: 1.5,
              }}
            >
              {project.description}
            </Typography>
          )}
        </Box>
        <Box
          data-testid="organization-home-project-actions"
          sx={{
            flexShrink: 0,
            pl: 1,
            pr: { xs: 0, sm: 2 },
          }}
        >
          {project.status === ProjectStatus.Onboarding ? (
            projectCapabilitiesForRole(project.currentUserRole)
              .deleteProject && (
              <CancelOnboardingAction
                organizationId={organizationId}
                projectId={project.id}
              />
            )
          ) : (
            <EntityStarToggle
              organizationId={organizationId}
              entityType={EntityType.Project}
              entityId={project.id}
              testId="organization-home-project-star-toggle"
            />
          )}
        </Box>
      </Box>
    ))}
  </Box>
);
