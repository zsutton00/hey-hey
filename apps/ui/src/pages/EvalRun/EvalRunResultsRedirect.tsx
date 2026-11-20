import React from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";

import { WebPathService } from "@hey-hey/ui-common/services";

/** Old `/results` links open the run's single page, keeping `?attempt=`. */
export const EvalRunResultsRedirect: React.FC = () => {
  const { projectId = "", evalId = "", runId = "" } = useParams();
  const { search } = useLocation();
  const runPath = WebPathService.evalRun({ projectId, evalId, runId });
  return <Navigate to={`${runPath}${search}`} replace />;
};
