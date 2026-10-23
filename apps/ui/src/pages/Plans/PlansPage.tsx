import { WorkStatus } from "@hey-hey/ui-common/api";
import { PlanArchiveDeleteDialog } from "@hey-hey/ui-common/components";
import {
  useProject,
  useProjectPlans,
  type PlanWorkItem,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import {
  Alert,
  IconButton,
  Pagination,
  Stack,
  Tab,
  Tabs,
  TextField,
} from "@mui/material";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { PageBreadcrumbs } from "../../components/Layout";
import { PlanSummaryList } from "../../components/Plans/PlanSummaryList";

const PLANS_PER_PAGE = 20;
type StatusTab = "active" | "verifying" | "completed" | "archived";
export interface PlansPageProps {
  organizationId?: string;
  projectId?: string;
  preview?: boolean;
}

export const PlansPage = ({
  organizationId,
  projectId: projectIdProp,
  preview = false,
}: PlansPageProps) => {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const identity = useUserIdentity();
  const projectId = projectIdProp ?? routeProjectId ?? "";
  const resolvedOrganizationId = organizationId ?? identity?.currentOrgId ?? "";
  const { plans, isLoading, error, refetch } = useProjectPlans(
    resolvedOrganizationId,
    projectId,
    {
      enabled: Boolean(resolvedOrganizationId && projectId),
    },
  );
  const { data: project } = useProject(resolvedOrganizationId, projectId, {
    enabled: Boolean(resolvedOrganizationId && projectId),
    preferStale: true,
  });
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<StatusTab>("active");
  const [page, setPage] = useState(1);
  const [managedPlan, setManagedPlan] = useState<PlanWorkItem | null>(null);
  const filtered = plans.filter((plan) => {
    const statusMatches =
      tab === "completed"
        ? plan.status === WorkStatus.Completed
        : tab === "archived"
          ? plan.status === WorkStatus.Archived
          : tab === "verifying"
            ? plan.status === WorkStatus.Verifying
            : !(
                [
                  WorkStatus.Completed,
                  WorkStatus.Archived,
                  WorkStatus.Verifying,
                  WorkStatus.Superseded,
                ] as WorkStatus[]
              ).includes(plan.status);
    return (
      statusMatches &&
      plan.name.toLowerCase().includes(search.trim().toLowerCase())
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PLANS_PER_PAGE));
  const visiblePage = Math.min(page, pages);
  return (
    <Stack spacing={3} data-testid="plans">
      {!preview && (
        <PageBreadcrumbs
          items={[
            { label: "Projects", to: "/projects" },
            {
              label: project?.name ?? "Project",
              to: "/projects/" + projectId,
              type: "project",
              entityId: projectId,
            },
            { label: "Plans", isCurrent: true },
          ]}
        />
      )}
      {error && <Alert severity="error">{error.message}</Alert>}
      <TextField
        label="Search plans"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      <Tabs
        value={tab}
        onChange={(_, value: StatusTab) => {
          setTab(value);
          setPage(1);
        }}
      >
        <Tab value="active" label="Active" />
        <Tab value="verifying" label="Verifying" />
        <Tab value="completed" label="Completed" />
        <Tab value="archived" label="Archived" />
      </Tabs>
      <PlanSummaryList
        plans={filtered.slice(
          (visiblePage - 1) * PLANS_PER_PAGE,
          visiblePage * PLANS_PER_PAGE,
        )}
        projectId={projectId}
        isLoading={isLoading}
        emptyTitle="No plans found."
        emptyDescription="Plans belong to Features. Open a Feature to start planning."
        renderActions={
          preview
            ? undefined
            : (plan) => (
                <IconButton
                  aria-label={"Manage " + plan.name}
                  onClick={() => setManagedPlan(plan)}
                >
                  <MoreHorizIcon />
                </IconButton>
              )
        }
      />
      {pages > 1 && (
        <Pagination
          count={pages}
          page={visiblePage}
          onChange={(_, next) => setPage(next)}
        />
      )}
      {managedPlan && (
        <PlanArchiveDeleteDialog
          open
          onClose={() => setManagedPlan(null)}
          organizationId={resolvedOrganizationId}
          projectId={projectId}
          planId={managedPlan.id}
          planName={managedPlan.name}
          planStatus={managedPlan.status}
          onComplete={() => {
            void refetch();
          }}
        />
      )}
    </Stack>
  );
};
