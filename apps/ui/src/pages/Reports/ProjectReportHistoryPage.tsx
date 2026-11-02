import { ProjectReportHistory } from "@hey-hey/ui-common/components";
import { useOrganization } from "@hey-hey/ui-common/context";
import { useProject } from "@hey-hey/ui-common/data";
import { WebPathService } from "@hey-hey/ui-common/services";
import { Alert, CircularProgress } from "@mui/material";
import { parseAsInteger, useQueryState } from "nuqs";
import { useNavigate, useParams } from "react-router-dom";
import { PageBreadcrumbs } from "../../components/Layout";

export const ProjectReportHistoryPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;
  const project = useProject(organizationId, projectId, {
    enabled: !!organizationId && !!projectId,
  });
  const navigate = useNavigate();
  const [offset, setOffset] = useQueryState(
    "offset",
    parseAsInteger.withDefault(0),
  );

  if (!organizationId || !projectId)
    return (
      <Alert severity="error">
        A current organization and project are required.
      </Alert>
    );
  if (project.isLoading || !project.isFetched)
    return <CircularProgress aria-label="Loading project" />;
  if (
    project.error ||
    !project.data ||
    project.data.organizationId !== organizationId ||
    project.data.id !== projectId
  )
    return (
      <Alert severity="error">
        This project is unavailable in the current organization.
      </Alert>
    );

  return (
    <>
      <PageBreadcrumbs
        sx={{ mb: 2 }}
        items={[
          { label: "Projects", to: "/projects" },
          {
            label: project.data.name ?? "Project",
            to: WebPathService.project(projectId),
            type: "project",
          },
          {
            label: "Reports",
            to: WebPathService.projectReportHistory(projectId),
            isCurrent: true,
          },
        ]}
      />
      <ProjectReportHistory
        organizationId={organizationId}
        projectId={projectId}
        offset={Math.max(0, offset)}
        onOffsetChange={(next) => void setOffset(next === 0 ? null : next)}
        onCreate={() => navigate(WebPathService.createProjectReport(projectId))}
      />
    </>
  );
};
