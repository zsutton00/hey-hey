import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  IconButton,
  List,
  ListItemButton,
  MenuItem,
  Pagination,
  Skeleton,
  Select,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import React from "react";
import { useNavigate } from "react-router-dom";
import { type ProposalResponseDto } from "../../api";
import {
  useProjectInfoActivity,
  type ProjectInfoActivityProposal,
} from "./useProjectInfoActivity";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import { usePathService } from "../../contexts";
import { useProject } from "../../data/hooks/useProject";
import { useProjectMetrics } from "../../data/hooks/useProjectMetrics";

import { Card } from "../Card";
import { useCanHover } from "../../hooks/useCanHover";
import { EntityIcon } from "../Entity";
import { getProposalDisplayTitle } from "../ProposalDispatchers/getProposalDisplayTitle";
import { OrganizationHomeEvidence } from "../OrganizationHome";
import { ProposalStatusPresentation } from "../ProposalStatusPresentation";

import { ProjectReportsOverview } from "./ProjectReportsOverview";
import { ProjectIdentity } from "./ProjectIdentity";

export interface ProjectOverviewProps {
  organizationId: string;
  projectId: string;
}

const formatLocalizedDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const ProjectOverviewLoading: React.FC = () => (
  <Box
    component="main"
    data-testid="project-overview-loading"
    aria-busy="true"
    sx={{ py: { xs: 3, sm: 4 }, px: { xs: 2, sm: 3 } }}
  >
    <Container maxWidth="lg" disableGutters>
      <Stack component="section" spacing={1}>
        <Skeleton variant="text" width="45%" height={48} />
        <Stack direction="row" spacing={1} alignItems="center">
          <Skeleton variant="text" width={140} />
          <Skeleton variant="rounded" width={88} height={22} />
        </Stack>
        <Skeleton variant="text" width="75%" />
      </Stack>
    </Container>
  </Box>
);

const ProjectOverviewError: React.FC<{ onRetry: () => void }> = ({
  onRetry,
}) => (
  <Box
    component="main"
    data-testid="project-overview-project-error"
    sx={{ py: { xs: 3, sm: 4 }, px: { xs: 2, sm: 3 } }}
  >
    <Container maxWidth="lg" disableGutters>
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
    </Container>
  </Box>
);

const ProjectInfoProposalRow: React.FC<{
  item: ProjectInfoActivityProposal;
  onOpen: (proposal: ProposalResponseDto) => void;
}> = ({ item, onOpen }) => {
  const { proposal, iconType, workItemIcon } = item;
  const title = getProposalDisplayTitle(proposal);

  return (
    <ListItemButton
      component="li"
      onClick={() => onOpen(proposal)}
      data-testid="project-info-proposal-row"
      data-proposal-id={proposal.id}
      sx={{
        display: "block",
        px: { xs: 1, sm: 2 },
        py: 1.5,
      }}
    >
      <Stack spacing={0.75} sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ minWidth: 0 }}
        >
          <EntityIcon
            entityType={iconType}
            workItemIcon={workItemIcon}
            size={24}
            aria-hidden="true"
            data-testid="project-info-proposal-icon"
            data-proposal-id={proposal.id}
          />
          <Typography
            variant="subtitle2"
            sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}
          >
            {title}
          </Typography>
          <ProposalStatusPresentation
            status={proposal.status}
            data-testid="project-info-proposal-status"
          />
        </Stack>
        {proposal.eli5 !== undefined && (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="project-info-proposal-eli5"
            data-proposal-id={proposal.id}
            sx={{
              display: "-webkit-box",
              overflow: "hidden",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflowWrap: "anywhere",
            }}
          >
            {proposal.eli5}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          <time dateTime={proposal.createdAt}>
            {formatLocalizedDateTime(proposal.createdAt)}
          </time>
        </Typography>
      </Stack>
    </ListItemButton>
  );
};

const ProjectInfoActivitySkeleton = () => (
  <Stack spacing={1.5} data-testid="project-info-activity-loading">
    <Skeleton variant="rounded" height={44} />
    <Skeleton variant="rounded" height={56} />
    <Skeleton variant="rounded" height={56} />
  </Stack>
);

export const ProjectInfoActivity: React.FC<{
  organizationId: string;
  projectId: string;
  windowStart?: string;
  windowEnd?: string;
}> = ({ organizationId, projectId, windowStart, windowEnd }) => {
  const navigate = useNavigate();
  const pathService = usePathService();
  const [activeTab, setActiveTab] = React.useState<"created" | "updated">(
    "created"
  );
  const {
    identity,
    snapshot,
    activityError,
    pending,
    retryActivity,
    createdQuery,
    updatedQuery,
  } = useProjectInfoActivity(
    organizationId,
    projectId,
    activeTab,
    windowStart,
    windowEnd
  );
  const openProposal = React.useCallback(
    (proposal: ProposalResponseDto) => {
      const path = proposal.groupMembership
        ? pathService.proposalGroup({
            projectId,
            groupId: proposal.groupMembership.groupId,
          })
        : pathService.proposal({
            projectId,
            proposalId: proposal.id,
          });
      navigate(path);
    },
    [navigate, pathService, projectId]
  );

  return (
    <ProjectInfoActivityView
      activity={{
        identity,
        snapshot,
        activityError,
        pending,
        retryActivity,
        createdQuery,
        updatedQuery,
      }}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onOpen={openProposal}
    />
  );
};

export interface ProjectInfoActivityViewProps {
  activity: ReturnType<typeof useProjectInfoActivity>;
  activeTab: "created" | "updated";
  onTabChange: (tab: "created" | "updated") => void;
  onOpen: (proposal: ProposalResponseDto) => void;
}

export const ProjectInfoActivityView = ({
  activity,
  activeTab,
  onTabChange,
  onOpen,
}: ProjectInfoActivityViewProps) => {
  const {
    identity,
    snapshot,
    activityError,
    pending,
    retryActivity,
    createdQuery,
    updatedQuery,
  } = activity;
  const items =
    (activeTab === "created" ? snapshot?.created : snapshot?.updated) ?? [];
  const pageMetadata =
    activeTab === "created" ? snapshot?.createdPage : snapshot?.updatedPage;
  const activeQuery = activeTab === "created" ? createdQuery : updatedQuery;
  const actionLabel = activeTab === "created" ? "created" : "updated";
  const canHover = useCanHover();
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Card
      title="Project Activity"
      inlineActionOnMobile
      titleAccessory={
        canHover && (
          <Tooltip title="Updates to project information and structure" arrow>
            <IconButton
              aria-label="About Project Activity"
              size="small"
              data-testid="project-activity-info"
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )
      }
      dataTestId="project-info-activity"
      action={
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ width: 24, height: 24 }} role="status" aria-live="polite">
            <Box
              component="span"
              sx={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clipPath: "inset(50%)",
                whiteSpace: "nowrap",
              }}
            >
              {snapshot && pending
                ? "Refreshing Project Activity"
                : snapshot && activityError
                ? "Couldn't refresh Project Activity. Showing the last successful results. Retry is available."
                : ""}
            </Box>
            {snapshot && pending && (
              <CircularProgress
                size={20}
                aria-label="Refreshing Project Activity"
              />
            )}
          </Box>
          {(!isCompact || activityError) && (
            <Box sx={{ width: 64, minHeight: 32 }}>
              {snapshot && activityError && (
                <Tooltip
                  describeChild
                  title="Couldn't refresh Project Activity. Showing the last successful results."
                >
                  <Button
                    size="small"
                    color="warning"
                    data-testid="project-info-activity-refresh-error"
                    onClick={retryActivity}
                  >
                    Retry
                  </Button>
                </Tooltip>
              )}
            </Box>
          )}
          <FormControl size="small">
            <Select
              defaultValue="24h"
              inputProps={{
                "aria-label": "Project Activity time range",
              }}
              sx={{ minWidth: isCompact ? 0 : 112 }}
            >
              <MenuItem value="24h">Last 24 hours</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      }
    >
      <Stack spacing={1.5}>
        <DataStateBoundary
          loading={pending && !activityError}
          fetched={Boolean(snapshot) || Boolean(activityError)}
          presentation={{
            queryIdentity: identity,
            hasUsableContent: Boolean(snapshot),
            transition: "opacity-height",
          }}
          initialContent={<ProjectInfoActivitySkeleton />}
        >
          {activityError && !snapshot ? (
            <Alert
              severity="error"
              data-testid="project-info-activity-error"
              action={
                <Button color="inherit" size="small" onClick={retryActivity}>
                  Retry
                </Button>
              }
            >
              We couldn&apos;t load Project Activity.
            </Alert>
          ) : snapshot ? (
            <>
              <Tabs
                value={activeTab}
                onChange={(_event, value: "created" | "updated") =>
                  onTabChange(value)
                }
                aria-label="Project Activity views"
                variant="fullWidth"
              >
                <Tab
                  value="created"
                  label={`Created (${snapshot?.createdPage.total ?? 0})`}
                />
                <Tab
                  value="updated"
                  label={`Updated (${snapshot?.updatedPage.total ?? 0})`}
                />
              </Tabs>
              <Divider />
              {items.length === 0 ? (
                <Typography
                  color="text.secondary"
                  data-testid="project-info-activity-empty"
                  sx={{ py: 2 }}
                >
                  No project information proposals {actionLabel} yet.
                </Typography>
              ) : (
                <List
                  disablePadding
                  data-testid={`project-info-activity-${activeTab}-list`}
                  sx={{
                    width: "100%",
                    "& > li:not(:last-child)": {
                      borderBottom: 1,
                      borderColor: "divider",
                    },
                  }}
                >
                  {items.map((item) => (
                    <ProjectInfoProposalRow
                      key={item.proposal.id}
                      item={item}
                      onOpen={onOpen}
                    />
                  ))}
                </List>
              )}
              {pageMetadata && pageMetadata.totalPages > 1 && (
                <Stack alignItems="center" sx={{ pt: 1 }}>
                  <Pagination
                    count={pageMetadata.totalPages}
                    page={pageMetadata.page}
                    onChange={(_event, nextPage) =>
                      activeQuery.goToPage(nextPage)
                    }
                    disabled={activeQuery.isFetching}
                    aria-label={`${actionLabel} project information proposal pages`}
                    data-testid={`project-info-activity-${activeTab}-pagination`}
                  />
                </Stack>
              )}
            </>
          ) : null}
        </DataStateBoundary>
      </Stack>
    </Card>
  );
};

export const ProjectOverview: React.FC<ProjectOverviewProps> = ({
  organizationId,
  projectId,
}) => {
  const navigate = useNavigate();
  const projectQuery = useProject(organizationId, projectId);
  const metricsQuery = useProjectMetrics(organizationId, projectId);
  const retryProject = React.useCallback(() => {
    void projectQuery.refetch().catch(() => undefined);
  }, [projectQuery]);
  const activateMetric = React.useCallback(
    (path: string) => navigate(path),
    [navigate]
  );

  if (projectQuery.isLoading || !projectQuery.isFetched) {
    return <ProjectOverviewLoading />;
  }

  if (projectQuery.error || !projectQuery.isReady || !projectQuery.data) {
    return <ProjectOverviewError onRetry={retryProject} />;
  }

  return (
    <Box
      component="main"
      data-testid="project-overview"
      sx={{ py: { xs: 3, sm: 4 }, px: { xs: 2, sm: 3 } }}
    >
      <Container maxWidth="lg" disableGutters>
        <Stack spacing={{ xs: 2, sm: 3 }}>
          <ProjectIdentity
            organizationId={organizationId}
            project={projectQuery.data}
          />
          <ProjectReportsOverview key={projectQuery.data.id} organizationId={organizationId} projectId={projectQuery.data.id} />
          <ProjectInfoActivity
            organizationId={organizationId}
            projectId={projectQuery.data.id}
            windowStart={metricsQuery.data?.windowStart}
            windowEnd={metricsQuery.data?.windowEnd}
          />
          <OrganizationHomeEvidence
            {...metricsQuery}
            organizationId={organizationId}
            onMetricActivate={activateMetric}
            viewScope="project"
            title="Task Activity"
            scopeLabel={projectQuery.data.name}
            description="Rolling activity counts for this project only."
            summaryAriaLabel={`${projectQuery.data.name} task activity summary`}
            infoDescription="Implementation work and its progress"
            includeProjectInfo={false}
          />
        </Stack>
      </Container>
    </Box>
  );
};

export default ProjectOverview;
