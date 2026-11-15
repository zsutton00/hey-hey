import { WebPathService } from "@hey-hey/ui-common/services";
import { Navigate, useParams, useSearchParams } from "react-router-dom";

/** Keeps pre-segment `/projects/:projectId/changes` links working. */
export function ChangesRedirect() {
  const { projectId = "" } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const filters = Object.fromEntries(searchParams.entries());

  return (
    <Navigate to={WebPathService.projectChanges(projectId, filters)} replace />
  );
}
