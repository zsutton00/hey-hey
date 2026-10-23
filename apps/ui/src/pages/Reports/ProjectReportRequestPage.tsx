import { ProjectReportRequest } from "@hey-hey/ui-common/components";
import { useOrganization } from "@hey-hey/ui-common/context";
import { useProject } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { WebPathService } from "@hey-hey/ui-common/services";
import { Alert, CircularProgress } from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { PageBreadcrumbs } from "../../components/Layout";

export const ProjectReportRequestPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentOrganization } = useOrganization();
  const identity = useUserIdentity();
  const navigate = useNavigate();
  const organizationId = currentOrganization?.id;
  const project = useProject(organizationId, projectId, { enabled: !!organizationId && !!projectId });
  if (!organizationId || !projectId || !identity?.userId) return <Alert severity="error">A current organization, project, and user are required.</Alert>;
  if (project.isLoading || !project.isFetched) return <CircularProgress aria-label="Loading project" />;
  if (project.error || !project.data || project.data.organizationId !== organizationId || project.data.id !== projectId) return <Alert severity="error">This project is unavailable in the current organization.</Alert>;
  return (
    <>
      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={[
          { label: "Projects", to: "/projects" },
          { label: project.data.name ?? "Project", to: WebPathService.project(projectId), type: "project" },
          { label: "New Report", to: `/projects/${projectId}/reports/new`, isCurrent: true },
        ]}
      />
      <ProjectReportRequest
        key={`${organizationId}:${projectId}:${identity.userId}`}
        organizationId={organizationId}
        projectId={projectId}
        currentUserId={identity.userId}
        timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
        onClose={() => navigate(WebPathService.project(projectId))}
        onOpenReport={(reportId) => navigate(WebPathService.report({ projectId, reportId }))}
      />
    </>
  );
};
