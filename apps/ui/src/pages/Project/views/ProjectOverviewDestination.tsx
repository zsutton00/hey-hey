import { ProjectStatus, type ProjectResponseDto } from "@hey-hey/ui-common/api";
import { ProjectOverview } from "@hey-hey/ui-common/components";
import { Alert, Box, Button, Skeleton, Stack } from "@mui/material";
import React from "react";
import { ProjectSetupIntroduction } from "./ProjectSetupIntroduction";

export interface ProjectOverviewDestinationProps {
  organizationId: string;
  projectId: string;
  project: ProjectResponseDto | null;
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export const ProjectOverviewDestination: React.FC<
  ProjectOverviewDestinationProps
> = ({ organizationId, projectId, project, isLoading, error, onRetry }) => {
  if (isLoading || (!project && !error)) {
    return (
      <Stack
        data-testid="project-overview-destination-loading"
        aria-busy="true"
        spacing={2}
        sx={{ p: 3 }}
      >
        <Skeleton variant="text" width="45%" height={48} />
        <Skeleton variant="rounded" height={180} />
      </Stack>
    );
  }

  if (error || !project) {
    return (
      <Box data-testid="project-overview-destination-error" sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          We couldn&apos;t load this project.
        </Alert>
      </Box>
    );
  }

  if (
    project.status !== ProjectStatus.Active &&
    !project.hasEstablishedActivity
  ) {
    return (
      <ProjectSetupIntroduction
        projectId={projectId}
        projectName={project.name}
      />
    );
  }

  return (
    <ProjectOverview organizationId={organizationId} projectId={projectId} />
  );
};
