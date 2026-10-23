import { Box, Stack, Typography } from "@mui/material";
import { EntityType, ProjectStatus, type ProjectResponseDto } from "../../api";
import { CancelOnboardingAction } from "../shared/CancelOnboardingAction";
import { EntityStarToggle } from "../Entity";
import { projectCapabilitiesForRole } from "../../hooks";
import { ProjectMetadata } from "../shared/ProjectMetadata";
import { ProjectTakingShapeLabel } from "../shared/ProjectTakingShapeLabel";

interface ProjectIdentityProps {
  organizationId: string;
  project: ProjectResponseDto;
}

export const ProjectIdentity = ({
  organizationId,
  project,
}: ProjectIdentityProps) => (
  <Box
    component="section"
    aria-labelledby="project-overview-title"
    data-testid="project-overview-identity"
  >
    <Stack
      direction="row"
      spacing={1}
      alignItems="flex-start"
      justifyContent="space-between"
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1.5,
          minWidth: 0,
        }}
      >
        <Typography
          component="h1"
          id="project-overview-title"
          variant="h4"
          sx={{
            minWidth: 0,
            overflowWrap: "anywhere",
            fontFamily:
              '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
            fontWeight: 600,
          }}
        >
          {project.name}
        </Typography>
        <ProjectTakingShapeLabel maturity={project.maturity} />
      </Box>
      {project.status === ProjectStatus.Onboarding ? (
        projectCapabilitiesForRole(project.currentUserRole).deleteProject && (
          <CancelOnboardingAction
            key={project.id}
            organizationId={organizationId}
            projectId={project.id}
          />
        )
      ) : (
        <EntityStarToggle
          organizationId={organizationId}
          entityType={EntityType.Project}
          entityId={project.id}
          size="medium"
          testId="project-overview-star-toggle"
        />
      )}
    </Stack>
    <Box sx={{ mt: 0.5 }}>
      <ProjectMetadata updatedAt={project.updatedAt} status={project.status} />
    </Box>
    {project.description && (
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{ mt: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {project.description}
      </Typography>
    )}
  </Box>
);
