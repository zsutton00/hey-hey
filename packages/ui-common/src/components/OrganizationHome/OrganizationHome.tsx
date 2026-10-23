import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  InputAdornment,
  Pagination,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityActorScopeMode,
  EntityType,
  ProjectStatus,
  type ProjectResponseDto,
} from "../../api";
import { usePathService } from "../../contexts";
import { useEntityStars } from "../../data/hooks/useEntityStars";
import { useProjectMetrics } from "../../data/hooks/useProjectMetrics";
import { useProjects } from "../../data/hooks/useProjects";
import { usePermissions } from "../../hooks";
import { TERMS } from "../../i18n/terminology";
import { Card } from "../Card";
import { EntityActionButton } from "../EntityActionButton";
import { OrganizationHomeEvidence } from "./OrganizationHomeEvidence";
import { OrganizationHomeProjectList } from "./OrganizationHomeProjectList";
import {
  OrganizationHomeHeader,
  type OrganizationHomeHeaderProps,
} from "./OrganizationHomeHeader";
import {
  paginateHomeProjects,
  projectMatchesSearch,
  selectCurrentUserProjectStars,
} from "./organizationHomeProjects";
export {
  projectMatchesSearch,
  formatProjectUpdatedAt,
  formatProjectStatus,
  selectCurrentUserProjectStars,
} from "./organizationHomeProjects";

export interface OrganizationHomeProps {
  /** The organization whose project and star scopes should be displayed. */
  organizationId: string | undefined;
  header: OrganizationHomeHeaderProps | null;
  /**
   * The signed-in user's ID. The stars endpoint is already user-scoped, but
   * this defensive filter keeps the surface correct if a shared response ever
   * contains more than one user's records.
   */
  currentUserId?: string;
  /** The host owns navigation and receives the canonical internal Activity path. */
  onMetricActivate: (path: string) => void;
  /** The host owns navigation to the existing project setup entrypoint. */
  onCreateProject: () => void;
}

const LoadingState: React.FC<{ testId: string; label: string }> = ({
  testId,
  label,
}) => (
  <Stack
    alignItems="center"
    justifyContent="center"
    spacing={1}
    sx={{ py: 5, color: "text.secondary" }}
    data-testid={testId}
  >
    <CircularProgress size={28} aria-label={label} />
    <Typography variant="body2">{label}</Typography>
  </Stack>
);

const ErrorState: React.FC<{
  testId: string;
  message: string;
  onRetry: () => void;
}> = ({ testId, message, onRetry }) => (
  <Alert
    severity="error"
    data-testid={testId}
    action={
      <Button color="inherit" size="small" onClick={onRetry}>
        Retry
      </Button>
    }
  >
    {message}
  </Alert>
);

export const OrganizationHome: React.FC<OrganizationHomeProps> = ({
  organizationId,
  currentUserId,
  onMetricActivate,
  onCreateProject,
  header,
}) => {
  const pathService = usePathService();
  const { createProjects: canCreateProjects } = usePermissions();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const projectQuery = useProjects(organizationId, {
    enabled: Boolean(organizationId),
  });
  const starQuery = useEntityStars(organizationId, {
    entityType: EntityType.Project,
    enabled: Boolean(organizationId),
  });
  const personalMetricsQuery = useProjectMetrics(
    organizationId,
    undefined,
    {},
    ActivityActorScopeMode.Personal,
    currentUserId,
  );
  const organizationMetricsQuery = useProjectMetrics(
    organizationId,
    undefined,
    {},
    ActivityActorScopeMode.Organization,
  );

  useEffect(() => {
    setSearchTerm("");
    setPage(1);
  }, [organizationId]);

  const currentUserProjectStars = useMemo(
    () =>
      selectCurrentUserProjectStars(
        starQuery.stars,
        organizationId ?? "",
        currentUserId,
      ),
    [currentUserId, organizationId, starQuery.stars],
  );
  const starredProjectIds = useMemo(
    () => new Set(currentUserProjectStars.map((star) => star.entityId)),
    [currentUserProjectStars],
  );
  const filteredProjects = useMemo(() => {
    const matchingProjects = projectQuery.projects.filter((project) =>
      projectMatchesSearch(project, searchTerm),
    );
    return matchingProjects
      .map((project, originalIndex) => ({ project, originalIndex }))
      .sort((left, right) => {
        const starDifference =
          Number(starredProjectIds.has(right.project.id)) -
          Number(starredProjectIds.has(left.project.id));
        return starDifference || left.originalIndex - right.originalIndex;
      })
      .map(({ project }) => project);
  }, [projectQuery.projects, searchTerm, starredProjectIds]);
  const projectPage = paginateHomeProjects(filteredProjects, page);
  useEffect(() => {
    setPage(projectPage.page);
  }, [projectPage.page]);
  const isProjectLoading =
    !organizationId || projectQuery.isLoading || !projectQuery.isFetched;
  const isStarLoading =
    Boolean(organizationId) && (starQuery.isLoading || !starQuery.isFetched);
  const entitlement = projectQuery.entitlement;
  const isEntitlementLoading = projectQuery.entitlementLoading;
  const isCreateProjectDisabled =
    isEntitlementLoading || !entitlement?.canCreateProject;
  const createProjectTooltip = isEntitlementLoading
    ? "Checking project availability."
    : `A higher plan is required to create another project.${
        entitlement?.creationUnavailableReason
          ? ` ${entitlement.creationUnavailableReason}`
          : ""
      }`;
  const pathForProject = (
    project: Pick<ProjectResponseDto, "id" | "status">,
  ): string =>
    project.status === ProjectStatus.Active
      ? pathService.project(project.id)
      : pathService.onboarding({ projectId: project.id });

  if (!organizationId) {
    return (
      <Box
        component="main"
        data-testid="organization-home-loading"
        sx={{ py: 10 }}
      >
        <LoadingState
          testId="organization-home-context-loading"
          label="Waiting for your organization..."
        />
      </Box>
    );
  }

  return (
    <Box
      component="main"
      data-testid="organization-home"
      aria-busy={isProjectLoading || isStarLoading}
      sx={{ py: { xs: 8, sm: 10 }, px: { xs: 2, sm: 3 } }}
    >
      <Container maxWidth="lg" disableGutters>
        {header && <OrganizationHomeHeader {...header} />}

        <Card
          title="Projects"
          dataTestId="organization-home-projects-card"
          inlineActionOnMobile
          action={
            canCreateProjects ? (
              <Stack spacing={0.5} alignItems="flex-end">
                {isCreateProjectDisabled ? (
                  <Tooltip title={createProjectTooltip} arrow>
                    <span data-testid="organization-home-create-project-tooltip-target">
                      <EntityActionButton
                        type="button"
                        variant="contained"
                        verb="create"
                        noun={TERMS.Project}
                        entityType="project"
                        disabled
                        onClick={onCreateProject}
                        data-testid="organization-home-create-project"
                      />
                    </span>
                  </Tooltip>
                ) : (
                  <EntityActionButton
                    type="button"
                    variant="contained"
                    verb="create"
                    noun={TERMS.Project}
                    entityType="project"
                    onClick={onCreateProject}
                    data-testid="organization-home-create-project"
                  />
                )}
              </Stack>
            ) : undefined
          }
        >
          <TextField
            fullWidth
            label="Search projects"
            placeholder="Search by project name or description"
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value);
              setPage(1);
            }}
            data-testid="organization-home-project-search"
            slotProps={{
              htmlInput: {
                "aria-controls": "organization-home-project-results",
                "data-testid": "organization-home-project-search-input",
              },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchOutlinedIcon aria-hidden="true" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ mb: 2 }}
          />

          <Box id="organization-home-project-results">
            {isProjectLoading || isStarLoading ? (
              <LoadingState
                testId="organization-home-projects-loading"
                label="Loading projects..."
              />
            ) : projectQuery.error || !projectQuery.isReady ? (
              <ErrorState
                testId="organization-home-projects-error"
                message="We couldn't load your projects."
                onRetry={() =>
                  void projectQuery.refetch().catch(() => undefined)
                }
              />
            ) : starQuery.error || !starQuery.isReady ? (
              <ErrorState
                testId="organization-home-project-stars-error"
                message="We couldn't load project star state."
                onRetry={() => void starQuery.refetch().catch(() => undefined)}
              />
            ) : projectQuery.projects.length === 0 ? (
              <Typography
                color="text.secondary"
                data-testid="organization-home-no-projects"
                sx={{ py: 5, textAlign: "center" }}
              >
                You don't have any projects yet.
              </Typography>
            ) : filteredProjects.length === 0 ? (
              <Typography
                color="text.secondary"
                data-testid="organization-home-no-search-results"
                sx={{ py: 5, textAlign: "center" }}
              >
                No projects match your search.
              </Typography>
            ) : (
              <OrganizationHomeProjectList
                projects={projectPage.projects}
                pathForProject={pathForProject}
                organizationId={organizationId}
              />
            )}
          </Box>
          {filteredProjects.length > 0 &&
            !isProjectLoading &&
            !isStarLoading &&
            projectQuery.isReady &&
            starQuery.isReady && (
              <Pagination
                data-testid="organization-home-project-pagination"
                page={projectPage.page}
                count={projectPage.pageCount}
                onChange={(_, nextPage) => setPage(nextPage)}
                size="small"
                sx={{ mt: 2, display: "flex", justifyContent: "center" }}
              />
            )}
          {entitlement && entitlement.canCreateProject && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 2 }}
              data-testid="organization-home-project-entitlement"
            >
              {entitlement.usage.projectCount} of {entitlement.projectLimit}{" "}
              projects used
            </Typography>
          )}
          {entitlement && !entitlement.canCreateProject && (
            <Alert
              severity="warning"
              variant="outlined"
              data-testid="organization-home-project-create-unavailable"
              sx={{ mt: 2, alignItems: "flex-start" }}
            >
              <Typography
                component="div"
                variant="body2"
                data-testid="organization-home-project-entitlement"
              >
                <strong>
                  {entitlement.usage.projectCount} of {entitlement.projectLimit}{" "}
                  projects used.
                </strong>{" "}
                A higher plan is required to create another project.
              </Typography>
              {entitlement.creationUnavailableReason && (
                <Typography
                  component="div"
                  variant="body2"
                  sx={{ mt: 0.5 }}
                  data-testid="organization-home-project-create-reason"
                >
                  {entitlement.creationUnavailableReason}
                </Typography>
              )}
            </Alert>
          )}
        </Card>

        <OrganizationHomeEvidence
          {...personalMetricsQuery}
          description="Work you created or moved forward across your accessible projects."
          includeProjectInfo={false}
          organizationId={organizationId}
          onMetricActivate={onMetricActivate}
          scopeLabel="Only you"
          title="My Activity"
        />
        <OrganizationHomeEvidence
          {...organizationMetricsQuery}
          description="Activity from everyone in the selected organization, limited to projects you can access."
          includeProjectInfo={false}
          organizationId={organizationId}
          onMetricActivate={onMetricActivate}
          scopeLabel="All accessible projects"
          title="Organization Activity"
        />
      </Container>
    </Box>
  );
};

export default OrganizationHome;
